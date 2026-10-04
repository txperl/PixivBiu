package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSkipRequestLog(t *testing.T) {
	cases := []struct {
		path   string
		status int
		skip   bool
	}{
		{imageProxyPath, http.StatusOK, true},
		{imageProxyPath, http.StatusPartialContent, true},
		{imageProxyPath, http.StatusNotModified, true},
		{imageProxyPath, http.StatusBadRequest, false},
		{imageProxyPath, http.StatusBadGateway, false},
		{imageProxyPath, 0, false},
		{apiBase + "/illusts/1", http.StatusOK, false},
		{"/assets/index.js", http.StatusOK, false},
	}
	for _, c := range cases {
		req := httptest.NewRequest(http.MethodGet, c.path+"?url=https%3A%2F%2Fi.pximg.net%2Fa.jpg", nil)
		if got := skipRequestLog(req, c.status); got != c.skip {
			t.Errorf("skipRequestLog(%q, %d) = %v, want %v", c.path, c.status, got, c.skip)
		}
	}
}
