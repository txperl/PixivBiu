// Command healthcheck is a tiny, dependency-free liveness probe for the Docker
// HEALTHCHECK on the distroless runtime image, which ships no shell or curl.
//
// It GETs the server's health endpoint on the loopback interface and exits 0
// when the service reports healthy, non-zero otherwise. The port mirrors the
// server's PIXIVBIU_SERVER_PORT (default 4001); the host is always loopback
// since the probe runs inside the same container.
package main

import (
	"net/http"
	"os"
	"time"
)

func main() {
	port := os.Getenv("PIXIVBIU_SERVER_PORT")
	if port == "" {
		port = "4001"
	}

	client := http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get("http://127.0.0.1:" + port + "/api/v1/health")
	if err != nil {
		os.Exit(1)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		os.Exit(1)
	}
}
