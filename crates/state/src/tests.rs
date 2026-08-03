//! Checkpoint/recovery failure matrix (spec 23 required failure tests).

use crate::manifest::CHECKPOINT_SCHEMA_VERSION;
use crate::recovery::recover_latest;
use crate::snapshot::{CheckpointDoc, OperatorState, ReplayPosition, SessionMeta};
use crate::store::{CheckpointStore, LATEST_FILE, MANIFEST_FILE, SNAPSHOT_FILE};

fn doc(id: &str, cursor: i64) -> CheckpointDoc {
    CheckpointDoc {
        schema_version: CHECKPOINT_SCHEMA_VERSION,
        checkpoint_id: id.to_owned(),
        session: SessionMeta {
            session_id: "s1".into(),
            incident_id: Some("rec-mem-001".into()),
            incident_path: Some("/tmp/x".into()),
            adversarial: false,
            adversarial_seed: 42,
        },
        replay: ReplayPosition {
            start_ns: 0,
            end_ns: 100,
            cursor_ns: cursor,
            state: "paused".into(),
            speed: "X10".into(),
        },
        global_watermark_ns: cursor,
        projection_version: 7,
        ws_sequence: 70,
        playback_epoch: 3,
        operators: vec![OperatorState {
            operator_id: "heatmap_tumbling".into(),
            watermark_ns: cursor,
            state_bytes: 3,
            blob: vec![1, 2, 3],
        }],
        emitted_evidence_ids: vec!["ev-abc".into()],
    }
}

fn store() -> (tempfile::TempDir, CheckpointStore) {
    let dir = tempfile::tempdir().unwrap();
    let store = CheckpointStore::new(dir.path());
    (dir, store)
}

#[test]
fn write_then_recover_round_trip() {
    let (_g, store) = store();
    let metrics = store.write(&doc("000001", 50)).unwrap();
    assert!(metrics.checkpoint_bytes > 0);
    let out = recover_latest(&store).unwrap();
    assert_eq!(out.doc, doc("000001", 50));
    assert!(!out.fell_back);
    assert_eq!(out.doc.operators[0].blob, vec![1, 2, 3]);
}

#[test]
fn corrupted_latest_falls_back_to_previous() {
    let (_g, store) = store();
    store.write(&doc("000001", 10)).unwrap();
    store.write(&doc("000002", 20)).unwrap();
    // Corrupt the newest snapshot payload.
    let path = store.checkpoint_dir("000002").join(SNAPSHOT_FILE);
    std::fs::write(&path, b"garbage").unwrap();
    let out = recover_latest(&store).unwrap();
    assert!(out.fell_back);
    assert_eq!(out.doc.checkpoint_id, "000001");
    assert_eq!(out.rejected.len(), 1);
    assert!(out.rejected[0].contains("checksum mismatch"));
}

#[test]
fn crash_during_checkpoint_write_leaves_previous_valid() {
    let (_g, store) = store();
    store.write(&doc("000001", 10)).unwrap();
    // Simulate a crash mid-write: temp dir exists, manifest never written,
    // LATEST still points at the old checkpoint.
    let tmp = store.root().join(".tmp-000002");
    std::fs::create_dir_all(&tmp).unwrap();
    std::fs::write(tmp.join(SNAPSHOT_FILE), b"partial").unwrap();
    let out = recover_latest(&store).unwrap();
    assert_eq!(out.doc.checkpoint_id, "000001");
    assert!(!out.fell_back);
}

#[test]
fn missing_manifest_is_rejected() {
    let (_g, store) = store();
    store.write(&doc("000001", 10)).unwrap();
    store.write(&doc("000002", 20)).unwrap();
    std::fs::remove_file(store.checkpoint_dir("000002").join(MANIFEST_FILE)).unwrap();
    let out = recover_latest(&store).unwrap();
    assert!(out.fell_back);
    assert_eq!(out.doc.checkpoint_id, "000001");
}

#[test]
fn manifest_id_mismatch_is_rejected() {
    let (_g, store) = store();
    store.write(&doc("000001", 10)).unwrap();
    // LATEST points at an id whose directory holds a different manifest.
    std::fs::write(store.root().join(LATEST_FILE), "000009").unwrap();
    let src = store.checkpoint_dir("000001");
    let dst = store.checkpoint_dir("000009");
    copy_dir(&src, &dst);
    let out = recover_latest(&store).unwrap();
    // 000009's manifest still says 000001 -> rejected, falls back to 000001.
    assert!(out.fell_back);
    assert_eq!(out.doc.checkpoint_id, "000001");
}

#[test]
fn all_corrupt_is_a_hard_error() {
    let (_g, store) = store();
    store.write(&doc("000001", 10)).unwrap();
    std::fs::write(store.checkpoint_dir("000001").join(SNAPSHOT_FILE), b"x").unwrap();
    let err = recover_latest(&store).unwrap_err();
    assert!(err.contains("all checkpoints failed validation"));
}

#[test]
fn empty_store_is_an_error() {
    let (_g, store) = store();
    assert!(recover_latest(&store).is_err());
}

#[test]
fn newest_valid_checkpoint_wins_without_latest_pointer() {
    let (_g, store) = store();
    store.write(&doc("000001", 10)).unwrap();
    store.write(&doc("000002", 20)).unwrap();
    std::fs::remove_file(store.root().join(LATEST_FILE)).unwrap();
    let out = recover_latest(&store).unwrap();
    assert_eq!(out.doc.checkpoint_id, "000002");
}

fn copy_dir(src: &std::path::Path, dst: &std::path::Path) {
    std::fs::create_dir_all(dst).unwrap();
    for entry in std::fs::read_dir(src).unwrap().flatten() {
        std::fs::copy(entry.path(), dst.join(entry.file_name())).unwrap();
    }
}
