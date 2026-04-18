package pixiv

import (
	"strconv"

	"github.com/txperl/pixivgo"
)

// NextOffset extracts the `offset` query parameter from a pixivgo next_url.
// Returns nil when the upstream has no further page.
func NextOffset(nextURL *string) *int64 {
	return extractInt64(nextURL, "offset")
}

// NextMaxBookmarkID extracts `max_bookmark_id` from a pixivgo next_url
// (used by /user/bookmarks/illust). Returns nil when absent.
func NextMaxBookmarkID(nextURL *string) *int64 {
	return extractInt64(nextURL, "max_bookmark_id")
}

func extractInt64(nextURL *string, key string) *int64 {
	v := pixivgo.ParseNextURL(nextURL)
	if v == nil {
		return nil
	}
	raw := v.Get(key)
	if raw == "" {
		return nil
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return nil
	}
	return &n
}
