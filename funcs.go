// File: funcs.go - Miscellaneous functions
// Author: @kimboslice99
// Created: 2025-02-15
// License: GNU General Public License v3.0 (GPLv3)

package main

import (
	"encoding/json"
	"log"
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
