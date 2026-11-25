import SwiftUI

struct TabOverview: View {
    let session: Session
    let onNewTab: () -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var textSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        NavigationStack {
            ScrollViewReader { scroll in
                ScrollView {
                    LazyVGrid(columns: [column], alignment: .leading, spacing: 14) {
                        ForEach(session.tabs, id: \.self) { tab in
                            TabCard(tab: tab, isCurrent: tab === session.current) {
                                session.select(tab)
                                dismiss()
                            } onClose: {
                                withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) {
                                    session.close(tab)
                                }
                            }
                        }
                    }
                    .padding(16)
                }
                .onAppear {
                    if let current = session.current { scroll.scrollTo(current, anchor: .center) }
                }
                .background(Color(uiColor: .systemGroupedBackground))
                .navigationTitle("Tabs")
                .toolbar {
                    if !session.closedTabs.isEmpty {
                        ToolbarItem(placement: .cancellationAction) {
                            Button {
                                session.reopenClosedTab()
                                dismiss()
                            } label: {
                                Label(L("Tab wiederherstellen", "Reopen closed tab"), systemImage: "arrow.uturn.backward")
                            }
                        }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(L("Fertig", "Done")) { dismiss() }
                    }
                }
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    Button {
                        onNewTab()
                        dismiss()
                    } label: {
                        Label(L("Neuer Tab", "New tab"), systemImage: "plus")
                            .font(.body.weight(.semibold))
                            .padding(.horizontal, 14)
                            .frame(minHeight: 44)
                    }
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.capsule)
                    .frame(maxWidth: .infinity)
                    .padding(10)
                    .background(.bar)
                }
            }
        }
    }

    private var column: GridItem {
        GridItem(textSize.isAccessibilitySize ? .flexible() : .adaptive(minimum: 144, maximum: 270), spacing: 14)
    }
}

private struct TabCard: View {
    let tab: Browser
    let isCurrent: Bool
    let onSelect: () -> Void
    let onClose: () -> Void

    var body: some View {
        Button(action: onSelect) {
            VStack(alignment: .leading, spacing: 0) {
                pagePreview
                HStack(spacing: 8) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(tab.label)
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(2)
                        if let host = tab.address?.host, host != tab.label {
                            Text(host)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                    Spacer(minLength: 0)
                    if isCurrent {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(.tint)
                            .accessibilityHidden(true)
                    }
                }
                .padding(12)
                .frame(minHeight: 56)
            }
            .foregroundStyle(.primary)
            .background(Color(uiColor: .secondarySystemGroupedBackground))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isCurrent ? .isSelected : [])
        .overlay(alignment: .topTrailing) {
            Button(role: .destructive, action: onClose) {
                Image(systemName: "xmark")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.primary)
                    .frame(width: 28, height: 28)
                    .background(.regularMaterial, in: .circle)
                    .frame(width: 44, height: 44)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(L("„\(tab.label)“ schließen", "Close “\(tab.label)”"))
        }
        .clipShape(.rect(cornerRadius: 16))
        .overlay {
            RoundedRectangle(cornerRadius: 16)
                .strokeBorder(isCurrent ? Color.accentColor : Color(uiColor: .separator), lineWidth: isCurrent ? 2 : 0.5)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }

    private var pagePreview: some View {
        Color(uiColor: .tertiarySystemFill)
            .aspectRatio(4 / 3, contentMode: .fit)
            .overlay {
                if let image = tab.previewImage {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                } else {
                    Image(systemName: tab.address == nil ? "shield.lefthalf.filled" : "globe")
                        .font(.largeTitle.weight(.light))
                        .foregroundStyle(.secondary)
                }
            }
            .clipped()
            .accessibilityHidden(true)
    }
}
