import Foundation
import SwiftData

@Model final class StoredRecord {
    @Attribute(.unique) var id: UUID
    var payload: Data
    init(id: UUID, payload: Data) { self.id = id; self.payload = payload }
}
@Model final class StoredAsset {
    @Attribute(.unique) var id: UUID
    var ownerID: UUID
    var name: String
    var createdAt: Date
    @Attribute(.externalStorage) var bytes: Data
    init(_ asset: WorkspaceAsset) {
        id = asset.id; ownerID = asset.ownerID; name = asset.name; createdAt = asset.createdAt; bytes = asset.data
    }
}
@Model final class StoredMetadata {
    @Attribute(.unique) var key: String
    var payload: Data
    init(payload: Data) { key = "workspace"; self.payload = payload }
}
@MainActor protocol WorkspaceRepository {
    func load() throws -> WorkspaceState
    func save(_ state: WorkspaceState) throws
}

@MainActor final class SwiftDataRepository: WorkspaceRepository {
    let container: ModelContainer
    init(inMemory: Bool = false) throws {
        let schema = Schema([StoredRecord.self, StoredAsset.self, StoredMetadata.self])
        let configuration = ModelConfiguration("GuangyiWorkspace", schema: schema, isStoredInMemoryOnly: inMemory, cloudKitDatabase: .none)
        container = try ModelContainer(for: schema, configurations: [configuration])
    }
    func load() throws -> WorkspaceState {
        let context = ModelContext(container)
        let metadata = try context.fetch(FetchDescriptor<StoredMetadata>())
        var state = try metadata.first.map { try JSONDecoder().decode(WorkspaceState.self, from: $0.payload) } ?? WorkspaceState()
        state.records = try context.fetch(FetchDescriptor<StoredRecord>()).map { try JSONDecoder().decode(WorkspaceRecord.self, from: $0.payload) }
        state.assets = try context.fetch(FetchDescriptor<StoredAsset>()).map {
            WorkspaceAsset(id: $0.id, ownerID: $0.ownerID, name: $0.name, data: $0.bytes, createdAt: $0.createdAt)
        }
        try WorkspaceLogic.validate(state)
        return state
    }
    func save(_ state: WorkspaceState) throws {
        // A fresh context keeps failed edits out of the observable working state.
        let context = ModelContext(container)
        context.autosaveEnabled = false
        let existing = try context.fetch(FetchDescriptor<StoredRecord>())
        let byID = Dictionary(uniqueKeysWithValues: existing.map { ($0.id, $0) })
        let liveIDs = Set(state.records.map(\.id))
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        for record in state.records {
            let payload = try encoder.encode(record)
            if let stored = byID[record.id] {
                if stored.payload != payload { stored.payload = payload }
            } else { context.insert(StoredRecord(id: record.id, payload: payload)) }
        }
        for removed in existing where !liveIDs.contains(removed.id) { context.delete(removed) }
        let assets = try context.fetch(FetchDescriptor<StoredAsset>())
        let assetByID = Dictionary(uniqueKeysWithValues: assets.map { ($0.id, $0) })
        let assetIDs = Set(state.assets.map(\.id))
        for asset in state.assets {
            if let stored = assetByID[asset.id] {
                stored.name = asset.name; stored.ownerID = asset.ownerID; stored.createdAt = asset.createdAt
                if stored.bytes != asset.data { stored.bytes = asset.data }
            } else { context.insert(StoredAsset(asset)) }
        }
        for removed in assets where !assetIDs.contains(removed.id) { context.delete(removed) }
        var metadataState = state
        metadataState.records = []; metadataState.assets = []
        let payload = try encoder.encode(metadataState)
        if let metadata = try context.fetch(FetchDescriptor<StoredMetadata>()).first { metadata.payload = payload }
        else { context.insert(StoredMetadata(payload: payload)) }
        try context.save()
    }
}
