package download

import (
	"path/filepath"
	"testing"
	"time"
)

func TestStore_LoadMissingReturnsEmpty(t *testing.T) {
	s := NewStore(filepath.Join(t.TempDir(), "downloads.json"))
	jobs, err := s.Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(jobs) != 0 {
		t.Errorf("expected empty, got %d", len(jobs))
	}
}

func TestStore_RoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "downloads.json")
	s := NewStore(path)

	now := time.Now().UTC().Truncate(time.Second)
	jobs := map[string]*Job{
		"job_1": {
			ID:         "job_1",
			IllustID:   123,
			IllustType: IllustTypeIllust,
			Title:      "Alpha",
			Status:     StatusCompleted,
			CreatedAt:  now,
			UpdatedAt:  now,
			Tasks: []*Task{
				{
					ID:              "tsk_1",
					JobID:           "job_1",
					URL:             "https://i.pximg.net/img-original/x.jpg",
					FilePath:        "/tmp/x.jpg",
					Status:          StatusCompleted,
					SizeBytes:       1024,
					DownloadedBytes: 1024,
					StartedAt:       now,
					FinishedAt:      now,
				},
			},
		},
	}

	if err := s.Save(jobs); err != nil {
		t.Fatalf("save: %v", err)
	}

	// New store pointing at the same path simulates restart.
	got, err := NewStore(path).Load()
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("want 1 job, got %d", len(got))
	}
	back := got["job_1"]
	if back == nil {
		t.Fatal("missing job_1")
	}
	if back.Title != "Alpha" || back.Status != StatusCompleted {
		t.Errorf("job fields not preserved: %+v", back)
	}
	if len(back.Tasks) != 1 || back.Tasks[0].FilePath != "/tmp/x.jpg" {
		t.Errorf("tasks not preserved: %+v", back.Tasks)
	}
}

func TestAggregateStatus(t *testing.T) {
	cases := []struct {
		name   string
		inputs []Status
		want   Status
	}{
		{"empty", nil, StatusQueued},
		{"all queued", []Status{StatusQueued, StatusQueued}, StatusQueued},
		{"one running", []Status{StatusQueued, StatusRunning}, StatusRunning},
		{"all completed", []Status{StatusCompleted, StatusCompleted}, StatusCompleted},
		{"any cancelled wins", []Status{StatusRunning, StatusCancelled}, StatusCancelled},
		{"failed only when no queue/run", []Status{StatusCompleted, StatusFailed}, StatusFailed},
		{"failed loses to running", []Status{StatusFailed, StatusRunning}, StatusRunning},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tasks := make([]*Task, len(tc.inputs))
			for i, st := range tc.inputs {
				tasks[i] = &Task{Status: st}
			}
			got := aggregateStatus(tasks)
			if got != tc.want {
				t.Errorf("%s: want %q, got %q", tc.name, tc.want, got)
			}
		})
	}
}
