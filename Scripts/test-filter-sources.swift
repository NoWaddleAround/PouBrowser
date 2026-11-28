// swiftc ios/Ruhe/FilterSources.swift Scripts/test-filter-sources.swift -o /tmp/pou-filter-test && /tmp/pou-filter-test
import Foundation

private final class Fixture: URLProtocol {
    static var revision = 1
    static var failSibling = false
    static var validators = [String: String]()

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let url = request.url!
        let part = url.lastPathComponent
        let tag = part == "ads" ? "\"ads-\(Self.revision)\"" : "\"privacy\""
        let sent = request.value(forHTTPHeaderField: "If-None-Match")
        Self.validators[part] = sent
        let code = part == "privacy" && Self.failSibling ? 503 : sent == tag ? 304 : 200
        let response = HTTPURLResponse(url: url, statusCode: code, httpVersion: nil, headerFields: ["ETag": tag])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        if code == 200 { client?.urlProtocol(self, didLoad: Data(tag.utf8)) }
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

@main private enum FilterSourcesTest {
    static func main() async throws {
        let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [Fixture.self]
        let session = URLSession(configuration: config)
        let group = FilterList(name: "test", addresses: ["https://example.invalid/ads", "https://example.invalid/privacy"], days: 1)
        func stage(_ installed: InstalledFilters.List?) async throws -> FilterSources.Download? {
            try await FilterSources.stage(group, installed: installed, reuse: true, session: session, root: root)
        }
        let first = try await stage(nil)!
        let active = InstalledFilters.List(slot: false, count: 2, parts: first.parts)
        let unchanged = try await stage(active)
        precondition(unchanged == nil)
        precondition(!FileManager.default.fileExists(atPath: InstalledFilters.directory("test", true, root: root).path))
        Fixture.revision = 2
        Fixture.failSibling = true
        do {
            _ = try await stage(active)
            fatalError("A failed group must not publish")
        } catch let error as URLError where error.code == .badServerResponse {}
        let original = try String(contentsOf: first.directory.appending(path: "0.txt"), encoding: .utf8)
        precondition(original == "\"ads-1\"")
        Fixture.failSibling = false
        let repaired = try await stage(active)!
        precondition(Fixture.validators == ["ads": "\"ads-1\"", "privacy": "\"privacy\""])
        let newBody = try String(contentsOf: repaired.directory.appending(path: "0.txt"), encoding: .utf8)
        let sibling = try String(contentsOf: repaired.directory.appending(path: "1.txt"), encoding: .utf8)
        precondition(newBody == "\"ads-2\"" && sibling == "\"privacy\"")
        try FileManager.default.removeItem(at: first.directory.appending(path: "1.txt"))
        _ = try await stage(active)
        precondition(Fixture.validators["privacy"] == nil)
        print("Passed first install, all-304, partial failure, mixed retry and missing cached body.")
    }
}
