package imgcache

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync/atomic"
	"time"
)

// touchInterval is how stale a cached file's mtime must be before a cache hit
// bothers bumping it. It keeps approximate-LRU recency while collapsing
// repeated hits on the same image to ~one Chtimes per interval.
const touchInterval = time.Hour

// sweepInterval is the cache manager's periodic resync — the correctness
// backstop bounding how long the cache may sit over the cap even if a
// write-kick is ever coalesced away. Writes also kick the manager for prompt
// eviction. A var so tests can shrink it.
var sweepInterval = 2 * time.Minute

// kickDebounce is the quiet window a write-kick waits before the manager
// sweeps. A burst of writes (e.g. a gallery loading many images) thus collapses
// into a single directory walk instead of one per write.
const kickDebounce = 2 * time.Second

// cache is a size-bounded directory of cached image files.
//
// The filesystem is the single source of truth: there is deliberately NO
// in-memory byte total to drift from disk. A background manager (run)
// reconciles the directory against the cap — on a periodic tick and whenever a
// write kicks it — by deleting the oldest files (by mtime, so cache hits that
// touch() a file keep it warm) until under a low-water mark. This reconcile-loop
// shape (akin to nginx's cache manager, or a Kubernetes controller's
// resync+event loop) is what makes concurrent writes, duplicate writes of the
// same key, and an already-over-cap startup all harmless: every sweep simply
// re-reads the current on-disk truth, so there is no accounting to corrupt.
type cache struct {
	dir      string
	maxBytes atomic.Int64  // ≤0 = unbounded (no eviction); hot-reloadable
	kick     chan struct{} // buffered(1): a write asks the manager to reconcile
}

func newCache(dir string, maxBytes int64) (*cache, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("create image cache dir %q: %w", dir, err)
	}
	c := &cache{dir: dir, kick: make(chan struct{}, 1)}
	c.maxBytes.Store(maxBytes)
	return c, nil
}

// run is the cache manager. It reconciles the directory against the cap on each
// periodic tick and on each write-kick until ctx is cancelled. The initial
// sweep handles a cache that is already over the cap at boot (limit lowered, or
// a prior run left it large). Launched by Proxy.Start.
func (c *cache) run(ctx context.Context) {
	c.sweep() // reconcile immediately on boot
	t := time.NewTicker(sweepInterval)
	defer t.Stop()
	// A write-kick arms a short debounce timer; further kicks during the window
	// fold into it, so a burst of writes triggers one sweep, not one per write.
	var debounce <-chan time.Time
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			c.sweep()
		case <-c.kick:
			if debounce == nil {
				debounce = time.After(kickDebounce)
			}
		case <-debounce:
			debounce = nil
			c.sweep()
		}
	}
}

// notify asks the manager to reconcile soon (non-blocking, coalesced). Called
// after a write grows the cache and after the cap is lowered. If a reconcile is
// already pending the signal folds into it; the periodic tick is the backstop
// if a signal is ever dropped this way.
func (c *cache) notify() {
	select {
	case c.kick <- struct{}{}:
	default:
	}
}

// setMax updates the hot-reloadable cap and kicks a reconcile so a lowered
// limit is enforced promptly rather than only on the next tick.
func (c *cache) setMax(maxBytes int64) {
	c.maxBytes.Store(maxBytes)
	c.notify()
}

// touch bumps a file's mtime to now so the sweeper treats it as recently used
// (approximate LRU). The hit path passes the file's current mtime so we can
// skip the syscall when it's already fresh — avoiding one Chtimes per served
// image on a thumbnail-heavy page. Best-effort; a missing file is fine.
func (c *cache) touch(path string, modTime time.Time) {
	now := time.Now()
	if now.Sub(modTime) < touchInterval {
		return
	}
	_ = os.Chtimes(path, now, now)
}

// sweep reconciles the directory against the cap: when the total on-disk size
// exceeds maxBytes, delete the oldest files (by mtime) until at or below the
// 90% low-water mark (the headroom avoids re-trimming on the very next write).
// It reads live disk state, so it is idempotent and safe to run alongside
// writers: a just-written file is the newest and won't be trimmed, and a file
// removed here is simply re-fetched on demand.
func (c *cache) sweep() {
	max := c.maxBytes.Load()
	if max <= 0 {
		return // unbounded
	}
	entries, err := os.ReadDir(c.dir)
	if err != nil {
		return
	}
	type fileInfo struct {
		path    string
		size    int64
		modTime time.Time
	}
	files := make([]fileInfo, 0, len(entries))
	var total int64
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		files = append(files, fileInfo{
			path:    filepath.Join(c.dir, e.Name()),
			size:    info.Size(),
			modTime: info.ModTime(),
		})
		total += info.Size()
	}
	if total <= max {
		return
	}

	sort.Slice(files, func(i, j int) bool {
		return files[i].modTime.Before(files[j].modTime)
	})
	lowWater := max * 9 / 10
	for _, f := range files {
		if total <= lowWater {
			break
		}
		if err := os.Remove(f.path); err != nil {
			continue
		}
		total -= f.size
	}
}
