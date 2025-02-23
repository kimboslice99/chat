// File: funcs.go - Miscellaneous functions
// Author: @kimboslice99
// Created: 2025-02-15
// License: GNU General Public License v3.0 (GPLv3)

package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strings"
)

// logger; A simple logger.
// Accepts DEBUG, INFO, and ERROR level.
func logger(level string, v ...interface{}) {
	levels := map[string]int{"DEBUG": 1, "INFO": 2, "ERROR": 3}
	currentLevel := levels[strings.ToUpper(*logLevel)]

	if levels[strings.ToUpper(level)] >= currentLevel {
		log.SetPrefix("[" + level + "] ")
		log.Println(v...)
	}
}

// addMessage; Append a message to cache.
// If cacheSize == 0 nothing is added.
func addMessage(msg MessageData) {
	messageCache = append(messageCache, msg)

	if len(messageCache) > *cacheSize {
		messageCache = messageCache[1:]
	}
}

// checkIfUserIn; Checks if user is in our userlist.
// Returns true if "name" is in list.
func checkIfUserIn(name string) bool {
	for user := range userlist {
		if userlist[user] == name {
			// "user" is in.
			return true
		}
	}
	return false
}

// forceLogin; sends client a force-login event.
func forceLogin(c *Client, message string) {
	forceLogin := Event{
		Event: "force-login",
		Data:  message,
	}

	forceLoginJson, err := json.Marshal(forceLogin)

	if err != nil {
		logger("ERROR", "Failed to encode force-login event:", err)
		return
	}
	c.send <- forceLoginJson
}

// etagMiddleware adds ETag headers to static file responses and handles conditional requests.
func etagMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		filePath := "html" + r.URL.Path
		if stat, err := os.Stat(filePath); err == nil && !stat.IsDir() {
			if etag, err := generateETag(filePath); err == nil {
				w.Header().Set("ETag", etag)
				w.Header().Set("Cache-Control", "public, max-age=0, must-revalidate")
				if match := r.Header.Get("If-None-Match"); match == etag {
					w.WriteHeader(http.StatusNotModified)
					return
				}
			}
		}
		next.ServeHTTP(w, r)
	})
}

// generateETag generates an ETag using file modification time and size.
// The format of the ETag is "modTime-size".
func generateETag(path string) (string, error) {
	info, err := os.Stat(path)
	if err != nil {
		return "", err
	}

	return fmt.Sprintf(`"%x-%x"`, info.ModTime().UnixNano(), info.Size()), nil
}
