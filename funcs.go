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

func forceRoom(c *Client, message string) {
	forceRoom := Event{
		Event: "force-room",
		Data:  message,
	}

	forceRoomJson, err := json.Marshal(forceRoom)

	if err != nil {
		logger("ERROR", "Failed to encode force-room event:", err)
		return
	}
	c.send <- forceRoomJson
}

// middleware adds ETag headers to static file responses and handles conditional requests.
func middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		filePath := "html" + r.URL.Path
		if stat, err := os.Stat(filePath); err == nil && !stat.IsDir() {
			if etag, err := generateETag(filePath); err == nil {
				w.Header().Set("ETag", etag)
				w.Header().Set("Cache-Control", "no-cache")
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

func executeCommandFromFile() ([]Credential, error) {
	// Read the command from a file
	data, err := os.ReadFile(".command")
	if err != nil {
		return nil, fmt.Errorf("error reading file: %v", err)
	}

	// Convert to string and split into command and arguments
	commandStr := strings.TrimSpace(string(data))
	parts := strings.Fields(commandStr) // Split into command and args
	if len(parts) == 0 {
		return nil, fmt.Errorf("no command found")
	}

	// First part is the command, the rest are arguments
	cmd := exec.Command(parts[0], parts[1:]...)

	// Capture JSON output
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("error executing command: %v", err)
	}

	// Try parsing JSON
	var creds []Credential
	err = json.Unmarshal(output, &creds)
	if err != nil {
		return nil, fmt.Errorf("error parsing JSON: %v", err)
	}

	// Return parsed JSON data
	return creds, nil
}
