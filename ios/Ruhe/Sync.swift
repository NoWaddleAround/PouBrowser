import CommonCrypto
import CryptoKit
import Foundation
import Observation
import SwiftUI

/// Sync between iPhone, Mac and Android without an account: every device keeps `PouBrowser-Sync.json` in a
/// folder the user picks once (iCloud Drive, Google Drive, Dropbox …). Each part of the file carries the time it
/// last changed; the newer side wins, part by part. Passwords are in it only encrypted with the sync password
/// (PBKDF2-SHA256, 200,000 rounds, AES-256-GCM; nonce + ciphertext + tag), the same format the Android app reads.
@MainActor @Observable
final class Sync {
    static let fileName = "PouBrowser-Sync.json"
    enum Part: String, CaseIterable { case bookmarks, blockedSites, unfilteredSites, scriptlessSites, passwords }

    private(set) var folder: URL?
    private(set) var status = ""
    private(set) var hasPassword = Keychain.read(Sync.passwordKey) != nil

    @ObservationIgnored weak var session: Session?
    @ObservationIgnored private var pending: Task<Void, Never>?
    private static let passwordKey = "PouBrowser Sync"

    init() {
        if let data = UserDefaults.standard.data(forKey: "sync.folder") {
            var stale = false
            folder = try? URL(resolvingBookmarkData: data, bookmarkDataIsStale: &stale)
        }
        #if DEBUG
        // Tests: `-syncFolder <path> -syncPassword <text>` stand in for the folder picker and the password field.
        if let path = UserDefaults.standard.string(forKey: "syncFolder") { folder = URL(fileURLWithPath: path) }
        if let password = UserDefaults.standard.string(forKey: "syncPassword") { Keychain.save(Self.passwordKey, password); hasPassword = true }
        #endif
    }

    func choose(_ picked: URL) {
        let access = picked.startAccessingSecurityScopedResource()
        defer { if access { picked.stopAccessingSecurityScopedResource() } }
        guard let data = try? picked.bookmarkData() else { status = L("Ordner ließ sich nicht merken", "Could not keep the folder"); return }
        UserDefaults.standard.set(data, forKey: "sync.folder")
        folder = picked
        Task { await run() }
    }

    func stop() {
        UserDefaults.standard.removeObject(forKey: "sync.folder")
        folder = nil
        status = ""
    }

    func setPassword(_ password: String) {
        if password.isEmpty { Keychain.delete(Self.passwordKey) } else { Keychain.save(Self.passwordKey, password) }
        hasPassword = !password.isEmpty
        Task { await run() }
    }

    /// A part changed on this device: stamp it and write soon.
    func changed(_ part: Part) {
        UserDefaults.standard.set(Date.now.timeIntervalSince1970 * 1000, forKey: "sync.stamp." + part.rawValue)
        guard folder != nil else { return }
        pending?.cancel()
        pending = Task {
            try? await Task.sleep(for: .seconds(2))
            if !Task.isCancelled { await run() }
        }
    }

    /// Reads the file, takes every newer part, writes back what is newer here.
    /// The file is read and written off the main thread, so two runs could overlap: a second one waits its turn.
    @ObservationIgnored private var running = false
    @ObservationIgnored private var runAgain = false

    func run() async {
        guard !running else { runAgain = true; return }
        running = true
        await runOnce()
        running = false
        if runAgain { runAgain = false; await run() }
    }

    private func runOnce() async {
        guard let folder, let session else { return }
        let access = folder.startAccessingSecurityScopedResource()
        defer { if access { folder.stopAccessingSecurityScopedResource() } }
        let file = folder.appending(path: Self.fileName)
        let read = await Task.detached { Self.coordinated(read: file) }.value   // a cloud file may download first
        var remote = (read.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] })?["parts"] as? [String: [String: Any]] ?? [:]
        var wrote = false, took: [String] = []
        let now = (Date.now.timeIntervalSince1970 * 1000).rounded()
        for part in Part.allCases {
            let stampKey = "sync.stamp." + part.rawValue
            let local = UserDefaults.standard.double(forKey: stampKey)
            let theirs = remote[part.rawValue]?["updated"] as? Double ?? 0
            if theirs > local, let entry = remote[part.rawValue] {
                // A device's first sync joins both sides instead of dropping what it had.
                let first = local == 0
                guard apply(part, entry["data"], salt: entry["salt"] as? String, joining: first, to: session) else { continue }
                took.append(part.rawValue)
                if first, let joined = export(part, from: session) {
                    remote[part.rawValue] = joined.merging(["updated": now]) { $1 }
                    UserDefaults.standard.set(now, forKey: stampKey)
                    wrote = true
                } else {
                    UserDefaults.standard.set(theirs, forKey: stampKey)
                }
            } else if local > theirs || theirs == 0, let entry = export(part, from: session),
                      local > 0 || !Self.isEmpty(entry["data"]) {
                let when = local > 0 ? local : now
                UserDefaults.standard.set(when, forKey: stampKey)
                remote[part.rawValue] = entry.merging(["updated": when]) { $1 }
                wrote = true
            }
        }
        if wrote, let data = try? JSONSerialization.data(withJSONObject: ["format": 1, "parts": remote], options: [.prettyPrinted, .sortedKeys]) {
            guard await Task.detached(operation: { Self.coordinated(write: data, to: file) }).value else {
                status = L("Schreiben fehlgeschlagen", "Could not write"); return
            }
        }
        status = L("Abgeglichen ", "Synced ") + Date.now.formatted(date: .omitted, time: .shortened)
            + (took.isEmpty ? "" : L(" · übernommen: ", " · taken: ") + took.joined(separator: ", "))
        session.log("SYNC " + status)
    }

    private func export(_ part: Part, from session: Session) -> [String: Any]? {
        switch part {
        case .bookmarks:
            return ["data": session.library.bookmarks.map {
                ["url": $0.url.absoluteString, "title": $0.title, "date": ($0.date.timeIntervalSince1970 * 1000).rounded()]
            }]
        case .blockedSites: return ["data": session.blockedSites.sorted()]
        case .unfilteredSites: return ["data": session.unfilteredSites.sorted()]
        case .scriptlessSites: return ["data": session.scriptlessSites.sorted()]
        case .passwords:
            guard let password = Keychain.read(Self.passwordKey) else { return nil }   // never in the clear
            let items = session.passwords.all().map { ["host": $0.host, "user": $0.user, "password": $0.password] }
            guard let plain = try? JSONSerialization.data(withJSONObject: items) else { return nil }
            let salt = Data((0..<16).map { _ in UInt8.random(in: 0...255) })
            guard let box = try? AES.GCM.seal(plain, using: Self.key(password, salt)).combined else { return nil }
            return ["data": box.base64EncodedString(), "salt": salt.base64EncodedString()]
        }
    }

    private static func isEmpty(_ data: Any?) -> Bool {
        (data as? [Any])?.isEmpty ?? (data == nil)
    }

    private func apply(_ part: Part, _ data: Any?, salt: String?, joining: Bool, to session: Session) -> Bool {
        switch part {
        case .bookmarks:
            guard let rows = data as? [[String: Any]] else { return false }
            var entries = rows.compactMap { row -> Library.Entry? in
                guard let url = URL(string: row["url"] as? String ?? "") else { return nil }
                return Library.Entry(url: url, title: row["title"] as? String ?? url.absoluteString,
                                     date: Date(timeIntervalSince1970: (row["date"] as? Double ?? 0) / 1000))
            }
            if joining {
                let known = Set(entries.map(\.url))
                entries += session.library.bookmarks.filter { !known.contains($0.url) }
            }
            session.library.replaceBookmarks(entries)
        case .blockedSites, .unfilteredSites, .scriptlessSites:
            guard let sites = data as? [String] else { return false }
            session.replaceSites(part, with: Set(sites), joining: joining)
        case .passwords:
            guard let password = Keychain.read(Self.passwordKey), let text = data as? String,
                  let box = Data(base64Encoded: text), let salt = salt.flatMap({ Data(base64Encoded: $0) }),
                  let sealed = try? AES.GCM.SealedBox(combined: box),
                  let plain = try? AES.GCM.open(sealed, using: Self.key(password, salt)),
                  let rows = try? JSONSerialization.jsonObject(with: plain) as? [[String: String]] else {
                status = L("Passwörter: falsches Sync-Passwort?", "Passwords: wrong sync password?")
                return false
            }
            var credentials = rows.map { Credential(host: $0["host"] ?? "", user: $0["user"] ?? "", password: $0["password"] ?? "") }
            if joining {
                let known = Set(credentials.map(\.id))
                credentials += session.passwords.all().filter { !known.contains($0.id) }
            }
            session.passwords.replaceAll(with: credentials)
        }
        return true
    }

    nonisolated static func key(_ password: String, _ salt: Data) -> SymmetricKey {
        var key = [UInt8](repeating: 0, count: 32)
        let passwordBytes = Array(password.utf8).map { Int8(bitPattern: $0) }
        salt.withUnsafeBytes { saltBytes in
            _ = CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), passwordBytes, passwordBytes.count,
                                     saltBytes.bindMemory(to: UInt8.self).baseAddress, salt.count,
                                     CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), 200_000, &key, key.count)
        }
        return SymmetricKey(data: key)
    }

    /// Cloud folders may hold only a placeholder: the coordinator downloads before reading.
    nonisolated private static func coordinated(read file: URL) -> Data? {
        var result: Data?
        NSFileCoordinator().coordinate(readingItemAt: file, options: [], error: nil) { result = try? Data(contentsOf: $0) }
        return result
    }

    nonisolated private static func coordinated(write data: Data, to file: URL) -> Bool {
        var done = false
        NSFileCoordinator().coordinate(writingItemAt: file, options: .forReplacing, error: nil) { done = (try? data.write(to: $0, options: .atomic)) != nil }
        return done
    }
}

/// The sync password lives in the keychain, not in the settings.
enum Keychain {
    private static func base(_ name: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: name]
    }

    /// False when this build may not use the keychain at all: a Mac build signed without a provisioning profile
    /// (no Apple account in Xcode) gets -34018 errSecMissingEntitlement for every item.
    static let usable: Bool = {
        let probe = base("PouBrowser probe")
        SecItemDelete(probe as CFDictionary)
        let status = SecItemAdd(probe.merging([kSecValueData as String: Data("1".utf8)]) { $1 } as CFDictionary, nil)
        SecItemDelete(probe as CFDictionary)
        return status == errSecSuccess
    }()
    static func read(_ name: String) -> String? {
        var result: CFTypeRef?
        let query = base(name).merging([kSecReturnData as String: true]) { $1 }
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return String(decoding: data, as: UTF8.self)
    }
    static func save(_ name: String, _ value: String) {
        delete(name)
        SecItemAdd(base(name).merging([kSecValueData as String: Data(value.utf8),
                                       kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock]) { $1 } as CFDictionary, nil)
    }
    static func delete(_ name: String) { SecItemDelete(base(name) as CFDictionary) }
}

/// Settings › Synchronisierung: the folder, the sync password, "Jetzt abgleichen".
struct SyncView: View {
    let sync: Sync
    @Environment(\.dismiss) private var dismiss
    @State private var picking = false
    @State private var password = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if let folder = sync.folder {
                        LabeledContent(L("Ordner", "Folder"), value: folder.lastPathComponent)
                        Button(L("Jetzt abgleichen", "Sync now"), systemImage: "arrow.triangle.2.circlepath") { Task { await sync.run() } }
                        Button(L("Anderen Ordner wählen", "Choose another folder"), systemImage: "folder") { picking = true }
                        Button(L("Synchronisierung beenden", "Stop syncing"), systemImage: "xmark.circle", role: .destructive) { sync.stop() }
                    } else {
                        Button(L("Sync-Ordner wählen …", "Choose sync folder …"), systemImage: "folder.badge.plus") { picking = true }
                    }
                    if !sync.status.isEmpty { Text(sync.status).foregroundStyle(.secondary) }
                } footer: {
                    Text(L("Wähle auf jedem Gerät denselben Cloud-Ordner, z. B. in iCloud Drive, Google Drive oder Dropbox. Abgeglichen werden Lesezeichen, gesperrte Seiten, Ausnahmen und – mit Sync-Passwort – Passwörter.",
                           "Pick the same cloud folder on every device, e.g. in iCloud Drive, Google Drive or Dropbox. Bookmarks, blocked sites, exceptions and – with a sync password – passwords are synced."))
                }
                if Keychain.usable { Section {
                    SecureField(sync.hasPassword ? L("Sync-Passwort ändern", "Change sync password") : L("Sync-Passwort festlegen", "Set sync password"), text: $password)
                        .textInputAutocapitalization(.never)
                        .onSubmit { save() }
                    Button(L("Sichern", "Save"), action: save).disabled(password.count < 8)
                    if sync.hasPassword {
                        Button(L("Passwörter nicht mehr abgleichen", "Stop syncing passwords"), role: .destructive) { sync.setPassword("") }
                    }
                } header: {
                    Text(L("Passwörter", "Passwords"))
                } footer: {
                    Text(L("Mindestens 8 Zeichen, auf allen Geräten gleich. Die Passwörter liegen nur damit verschlüsselt im Ordner; ohne Sync-Passwort bleiben sie auf dem Gerät.",
                           "At least 8 characters, the same on all devices. Passwords are in the folder only encrypted with it; without a sync password they stay on the device."))
                } }
            }
            .navigationTitle(L("Synchronisierung", "Sync"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Fertig", "Done")) { dismiss() } } }
            .fileImporter(isPresented: $picking, allowedContentTypes: [.folder]) { result in
                if case .success(let url) = result { sync.choose(url) }
            }
        }
    }

    private func save() {
        guard password.count >= 8 else { return }
        sync.setPassword(password)
        password = ""
    }
}
