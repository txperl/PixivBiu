package download

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sync/atomic"
	"time"

	"github.com/txperl/pixivgo"

	"github.com/txperl/PixivBiu/internal/atomicfile"
)

// MetadataSnapshot freezes upstream JSON once per job. RawMessage preserves
// pixivgo's wire representation without maintaining a second artwork model.
// It is immutable after submission, and copied when exposing job snapshots.
type MetadataSnapshot struct {
	CapturedAt time.Time       `json:"captured_at"`
	Illust     json.RawMessage `json:"illust"`
	Ugoira     json.RawMessage `json:"ugoira,omitempty"`
}

type metadataFile struct {
	SchemaVersion int    `json:"schema_version"`
	SourceURL     string `json:"source_url"`
	JobID         string `json:"job_id"`
	TaskID        string `json:"task_id"`
	FileName      string `json:"file_name"`
	PageIndex     int    `json:"page_index"`
	UgoiraFormat  string `json:"ugoira_format,omitempty"`
	MetadataSnapshot
}

func captureMetadata(info pixivgo.IllustrationInfo, now time.Time) (*MetadataSnapshot, error) {
	data, err := json.Marshal(info)
	if err != nil {
		return nil, fmt.Errorf("capture artwork metadata: %w", err)
	}
	return &MetadataSnapshot{CapturedAt: now, Illust: data}, nil
}

func marshalMetadata(job *Job, task *Task) ([]byte, error) {
	return json.MarshalIndent(metadataFile{
		SchemaVersion:    1,
		SourceURL:        fmt.Sprintf("https://www.pixiv.net/artworks/%d", job.IllustID),
		JobID:            job.ID,
		TaskID:           task.ID,
		FileName:         filepath.Base(task.FilePath),
		PageIndex:        task.PageIndex,
		UgoiraFormat:     job.UgoiraFormat,
		MetadataSnapshot: *job.Metadata,
	}, "", "  ")
}

// writeMetadata accepts an existing file only if it is byte-for-byte the
// expected export, including job/task identity. This covers a crash between
// rename and persisting WroteMetadata, without adopting someone else's JSON.
// Reservations and this check share the media writer's single-manager trust
// boundary: another process replacing a path concurrently is not supported.
func writeMetadata(ctx context.Context, path string, data []byte) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	st, err := os.Lstat(path)
	if err == nil {
		if !st.Mode().IsRegular() || st.Size() != int64(len(data)) {
			return fmt.Errorf("metadata destination already exists")
		}
		f, err := os.Open(path)
		if err != nil {
			return err
		}
		defer f.Close()
		existing, err := io.ReadAll(io.LimitReader(f, int64(len(data))+1))
		if err != nil {
			return err
		}
		if !bytes.Equal(existing, data) {
			return fmt.Errorf("metadata destination belongs to another export")
		}
		return nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return atomicfile.Write(path, data)
}

// runMetadata keeps task running until the sidecar is committed. Ownership is
// recorded even when cancellation won during the write, so cleanup can remove
// the late artefact. Shutdown instead keeps it for recovery.
func (m *Manager) runMetadata(ctx, parent context.Context, job *Job, task *Task) {
	m.mu.RLock()
	if task.Status != StatusRunning {
		m.mu.RUnlock()
		return
	}
	snap := snapshotTaskLocked(task)
	m.mu.RUnlock()

	data, err := marshalMetadata(job, snap)
	if err == nil {
		err = writeMetadata(ctx, snap.MetadataPath, data)
	}
	m.finishMetadata(ctx, parent, task, err)
}

func (m *Manager) finishMetadata(ctx, parent context.Context, task *Task, err error) {
	m.mu.Lock()
	if err == nil {
		task.WroteMetadata = true
	} else if !errors.Is(err, context.Canceled) {
		// A conflicting or unreadable file cannot be claimed for cleanup.
		task.WroteMetadata = false
	}
	switch {
	case errors.Is(err, context.Canceled) || ctx.Err() != nil:
		resolveCancelled(task, parent)
	case err != nil:
		transitionTaskTerminalLocked(task, StatusFailed, "metadata: unable to save metadata file")
	default:
		transitionTaskTerminalLocked(task, StatusCompleted, "")
	}
	cleanup := task.Status == StatusCancelled
	var paths []string
	if cleanup {
		paths = writtenPaths([]*Task{task})
	}
	m.mu.Unlock()
	m.removeCleanupPaths(paths)
	if err != nil && !errors.Is(err, context.Canceled) {
		m.logger.Warn("download metadata write failed", slog.String("task_id", task.ID), slog.Any("error", err))
	}
}

// reuseMedia only trusts a persisted write by this task. Missing files are
// downloaded again; an unexpected object at an owned path is a task failure.
func (m *Manager) reuseMedia(job *Job, task *Task) (bool, error) {
	m.mu.RLock()
	owned, path := task.WroteFile, task.FilePath
	m.mu.RUnlock()
	if !owned {
		return false, nil
	}
	st, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		// The HTTP payload is always a zip, even if a persisted task had
		// already advanced to a converted output that was since removed.
		downloadPath := path
		if job != nil && job.IllustType == IllustTypeUgoira && !isZipPath(path) {
			downloadPath = replaceExt(path, ".zip")
			if fileExists(downloadPath) {
				return false, fmt.Errorf("ugoira intermediate destination already exists")
			}
		}
		m.mu.Lock()
		task.WroteFile = false
		task.FilePath = downloadPath
		m.mu.Unlock()
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !st.Mode().IsRegular() {
		m.mu.Lock()
		task.WroteFile = false
		m.mu.Unlock()
		return false, fmt.Errorf("download output is not a regular file")
	}
	// Start resets running progress. A recovered media file is already
	// complete; restore both counters before the terminal progress event.
	atomic.StoreInt64(&task.SizeBytes, st.Size())
	atomic.StoreInt64(&task.DownloadedBytes, st.Size())
	return true, nil
}
