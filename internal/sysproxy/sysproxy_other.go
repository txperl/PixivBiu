//go:build !darwin && !windows

package sysproxy

import "context"

// detectSystem has no GUI proxy source to read on these platforms (Linux, BSD,
// …): desktop proxy settings there are conventionally exported as
// HTTP(S)_PROXY env vars, which Detect already covers via detectEnv. Returns
// nil so only the environment-variable candidates apply.
func detectSystem(_ context.Context) []string { return nil }
