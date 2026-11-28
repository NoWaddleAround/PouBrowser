import LocalAuthentication
import Observation
import Security
import SwiftUI
import WebKit

/// A saved sign-in. `host` is the page's host without "www.".
struct Credential: Identifiable, Hashable, Codable {
    var id: String { host + "\n" + user }
    let host: String
    let user: String
    var password: String
}

/// Chrome-style password manager: sign-ins live in the system keychain, filling and showing them needs
/// Face ID, Touch ID or the device passcode. Typed passwords only ever travel through the app's own script world.
@MainActor @Observable
final class Passwords {
    /// Hosts with saved sign-ins (no secrets), for the key button in the address field.
    private(set) var hosts: Set<String> = []
    @ObservationIgnored private var unlockedUntil = Date.distantPast
    /// Why the last unlock failed, for the notice.
    @ObservationIgnored private(set) var lastError: String?
    /// Bumped on every change, so the sync can tell (`Sync.swift`).
    var changed: () -> Void = {}

    init() { hosts = Set(Self.query(nil, secrets: false).map(\.host)) }

    static func host(of url: URL?) -> String? {
        guard let url, let host = url.host()?.lowercased(),
              url.scheme == "https" || (url.scheme == "http" && ["localhost", "127.0.0.1"].contains(host)) else { return nil }
        return host.replacing(/^www\./, with: "")
    }

    func has(_ url: URL?) -> Bool { Self.host(of: url).map(hosts.contains) ?? false }

    /// Accounts for a host, without passwords.
    func accounts(for url: URL?) -> [Credential] {
        guard let host = Self.host(of: url) else { return [] }
        return Self.query(host, secrets: false)
    }

    /// Asks for Face ID, Touch ID or the passcode. Browsing saved passwords can reuse a recent unlock.
    func unlock(_ reason: String, allowReuse: Bool = true) async -> Bool {
        lastError = nil
        if allowReuse && unlockedUntil > .now { return true }
        let context = LAContext()
        do {
            guard try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) else { return false }
        } catch {
            lastError = error.localizedDescription
            return false
        }
        unlockedUntil = .now.addingTimeInterval(120)
        return true
    }

    func all() -> [Credential] { Self.query(nil, secrets: true).sorted { ($0.host, $0.user) < ($1.host, $1.user) } }

    func password(for account: Credential) -> String? {
        Self.query(account.host, secrets: true).first { $0.user == account.user }?.password
    }

    func isSaved(_ credential: Credential) -> Bool {
        password(for: credential) == credential.password
    }

    /// The keychain's status code; errSecSuccess when saved.
    @discardableResult
    func save(_ credential: Credential, notify: Bool = true) -> OSStatus {
        let match = Self.base(credential.host).merging([kSecAttrAccount as String: credential.user]) { $1 }
        let secret = [kSecValueData as String: Data(credential.password.utf8)]
        var status = SecItemUpdate(match as CFDictionary, secret as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(match.merging(secret) { $1 }.merging([kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlocked]) { $1 } as CFDictionary, nil)
        }
        guard status == errSecSuccess else { return status }
        hosts.insert(credential.host)
        if notify { changed() }
        return status
    }

    func delete(_ credential: Credential, notify: Bool = true) {
        SecItemDelete(Self.base(credential.host).merging([kSecAttrAccount as String: credential.user]) { $1 } as CFDictionary)
        if Self.query(credential.host, secrets: false).isEmpty { hosts.remove(credential.host) }
        if notify { changed() }
    }

    /// Replaces every saved sign-in (the sync's newer copy from another device).
    func replaceAll(with credentials: [Credential]) {
        SecItemDelete(Self.base(nil) as CFDictionary)
        hosts = []
        credentials.forEach { save($0, notify: false) }
    }

    private static func base(_ host: String?) -> [String: Any] {
        var query: [String: Any] = [kSecClass as String: kSecClassInternetPassword, kSecAttrLabel as String: "PouBrowser"]
        if let host { query[kSecAttrServer as String] = host }
        return query
    }

    private static func query(_ host: String?, secrets: Bool) -> [Credential] {
        var query = base(host)
        query[kSecMatchLimit as String] = kSecMatchLimitAll
        query[kSecReturnAttributes as String] = true
        if secrets { query[kSecReturnData as String] = true }
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let items = result as? [[String: Any]] else { return [] }
        return items.compactMap { item in
            guard let host = item[kSecAttrServer as String] as? String else { return nil }
            let password = (item[kSecValueData as String] as? Data).map { String(decoding: $0, as: UTF8.self) } ?? ""
            return Credential(host: host, user: item[kSecAttrAccount as String] as? String ?? "", password: password)
        }
    }
}

extension Browser {
    /// Watches sign-in forms: on submit (or the button / Enter that sends them) it reports user name and password
    /// to the app, and `pouFill` fills a saved sign-in. App script world only, so the page sees neither.
    static let passwordScript = WKUserScript(source: """
        (() => {
            if (window.pouFill) return;
            const visible = input => input.offsetParent !== null || input.getClientRects().length > 0;
            const fields = root => {
                const scope = root && root.querySelectorAll ? root : document;
                const password = [...scope.querySelectorAll('input[type=password]')].find(input => visible(input));
                if (!password) return null;
                const named = [...(password.form || document).querySelectorAll('input')].filter(input =>
                    ['text', 'email', 'tel', ''].includes(input.type) && visible(input)
                    && (input.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING));
                return { password, user: named.pop() || null };
            };
            let last = '';
            const report = root => {
                const found = fields(root);
                if (!found || !found.password.value) return;
                const user = found.user ? found.user.value.trim() : '';
                if (user + '\\n' + found.password.value === last) return;
                last = user + '\\n' + found.password.value;
                try { webkit.messageHandlers.password.postMessage(JSON.stringify({ user, password: found.password.value })); } catch (error) {}
            };
            addEventListener('submit', event => report(event.target), true);
            addEventListener('click', event => {
                const button = event.target.closest && event.target.closest('button, input[type=submit], [role=button]');
                if (button) setTimeout(() => report(button.form || document), 0);
            }, true);
            addEventListener('keydown', event => {
                if (event.key === 'Enter' && event.target.type === 'password') report(event.target.form || document);
            }, true);
            const set = (input, value) => {
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            };
            window.pouFill = (user, password) => {
                const found = fields(document);
                if (!found) return false;
                if (found.user && user) set(found.user, user);
                set(found.password, password);
                return true;
            };
        })();
        """, injectionTime: .atDocumentEnd, forMainFrameOnly: false, in: .defaultClient)

    /// A form sent a sign-in. The host comes from the frame WebKit names, not from the page.
    func passwordSubmitted(_ body: String, frame: WKFrameInfo) {
        let local = ["localhost", "127.0.0.1"].contains(frame.securityOrigin.host)
        guard !isPrivate, frame.securityOrigin.protocol == "https" || local,
              let data = try? JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: String],
              let password = data["password"], !password.isEmpty, password.count < 500,
              let host = Optional(frame.securityOrigin.host.lowercased().replacing(/^www\./, with: "")), !host.isEmpty else { return }
        guard Keychain.usable else { return }
        let credential = Credential(host: host, user: String((data["user"] ?? "").prefix(200)), password: password)
        guard session.current === self, !session.passwords.isSaved(credential) else { return }
        session.passwordOffer = credential
    }

    /// Fills a saved sign-in into the page in front, after Face ID, Touch ID or the passcode.
    func fill(_ account: Credential) async {
        guard session.current === self, let webView, let page = webView.url,
              Passwords.host(of: page) == account.host else { return }
        let reason = L("Passwort für \(account.host) einsetzen", "Fill the password for \(account.host)")
        guard await session.passwords.unlock(reason, allowReuse: false) else {
            log("PASSWORT nicht entsperrt: \(session.passwords.lastError ?? "abgebrochen")")
            show(L("Nicht entsperrt", "Not unlocked") + (session.passwords.lastError.map { ": " + $0 } ?? ""), symbol: "lock")
            return
        }
        guard session.current === self, self.webView === webView, webView.url == page,
              let password = session.passwords.password(for: account) else { return }
        let filled = try? await webView.callAsyncJavaScript(
            "return location.origin === new URL(page).origin && window.pouFill ? pouFill(user, password) : false",
            arguments: ["page": page.absoluteString, "user": account.user, "password": password], contentWorld: .defaultClient) as? Bool
        log("PASSWORT eingesetzt auf \(account.host): \(filled == true)")
        if filled != true { show(L("Kein Anmeldefeld auf dieser Seite gefunden", "No sign-in field found on this page"), symbol: "key") }
    }
}

/// The key in the address field: pick a saved account of this site to fill it in.
struct PasswordButton: View {
    let browser: Browser
    let passwords: Passwords

    var body: some View {
        Menu {
            ForEach(passwords.accounts(for: browser.address)) { account in
                Button(account.user.isEmpty ? L("(ohne Namen)", "(no name)") : account.user, systemImage: "person") {
                    Task { await browser.fill(account) }
                }
            }
        } label: {
            Label(L("Gespeichertes Passwort einsetzen", "Fill saved password"), systemImage: "key.fill")
                .labelStyle(.iconOnly)
                .frame(width: 30, height: 34)
                .contentShape(.rect)
        }
        .tint(.secondary)
        .help(L("Gespeichertes Passwort einsetzen", "Fill saved password"))
    }
}

/// All saved sign-ins, opened after Face ID, Touch ID or the passcode. Swipe or right-click deletes.
struct PasswordsView: View {
    let passwords: Passwords
    @Environment(\.dismiss) private var dismiss
    @State private var items = [Credential]()
    @State private var unlocked = false
    @State private var filter = ""
    @State private var shown: Set<String> = []

    var body: some View {
        NavigationStack {
            List {
                ForEach(items.filter { filter.isEmpty || $0.host.localizedCaseInsensitiveContains(filter) || $0.user.localizedCaseInsensitiveContains(filter) }) { item in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(item.host).font(.headline)
                        Text(item.user.isEmpty ? L("(ohne Namen)", "(no name)") : item.user).foregroundStyle(.secondary)
                        HStack {
                            Text(shown.contains(item.id) ? item.password : String(repeating: "•", count: 10))
                                .font(.system(.body, design: .monospaced))
                                .textSelection(.enabled)
                            Spacer()
                            Button(shown.contains(item.id) ? L("Verbergen", "Hide") : L("Zeigen", "Show"),
                                   systemImage: shown.contains(item.id) ? "eye.slash" : "eye") {
                                if shown.contains(item.id) { shown.remove(item.id) } else { shown.insert(item.id) }
                            }
                            .labelStyle(.iconOnly)
                            .buttonStyle(.borderless)
                            Button(L("Kopieren", "Copy"), systemImage: "doc.on.doc") { UIPasteboard.general.string = item.password }
                                .labelStyle(.iconOnly)
                                .buttonStyle(.borderless)
                        }
                    }
                    .swipeActions { Button(L("Löschen", "Delete"), systemImage: "trash", role: .destructive) { delete(item) } }
                    .contextMenu { Button(L("Löschen", "Delete"), systemImage: "trash", role: .destructive) { delete(item) } }
                }
            }
            .overlay {
                if !Keychain.usable {
                    ContentUnavailableView(L("Auf diesem Gerät nicht verfügbar", "Not available on this device"), systemImage: "key.slash",
                                           description: Text(L("Diese Mac-Version ist ohne Apple-Konto signiert und darf den Schlüsselbund nicht nutzen. In Xcode unter Einstellungen › Accounts ein Apple-Konto anmelden und neu bauen, dann geht es.",
                                                               "This Mac build is signed without an Apple account and may not use the keychain. Sign in to an Apple account in Xcode › Settings › Accounts and build again.")))
                } else if !unlocked {
                    ContentUnavailableView(L("Gesperrt", "Locked"), systemImage: "lock")
                } else if items.isEmpty {
                    ContentUnavailableView(L("Keine Passwörter", "No passwords"), systemImage: "key",
                                           description: Text(L("Beim Anmelden auf einer Seite fragt PouBrowser, ob es das Passwort speichern soll.",
                                                               "When you sign in on a site, PouBrowser offers to save the password.")))
                }
            }
            .searchable(text: $filter, prompt: L("Suchen", "Search"))
            .navigationTitle(L("Passwörter", "Passwords"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Fertig", "Done")) { dismiss() } } }
            .task {
                guard Keychain.usable else { return }
                unlocked = await passwords.unlock(L("Gespeicherte Passwörter anzeigen", "Show saved passwords"))
                if unlocked { items = passwords.all() }
            }
        }
    }

    private func delete(_ item: Credential) {
        passwords.delete(item)
        items.removeAll { $0 == item }
    }
}
