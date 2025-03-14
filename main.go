// File: main.go - Entry point for the chat server
// Author: @kimboslice99
// Created: 2025-02-15
// License: GNU General Public License v3.0 (GPLv3)

package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
)

var address = flag.String("bind", ":8090", "bind service to address.")
var logLevel = flag.String("log", "INFO", "Log level (DEBUG, INFO, ERROR).")
var cache = flag.Int("cache", 0, "Message cache size.")
var maxMessageSize = flag.Int64("readlimit", 1, "Maximum message size in MB.")
var certFile = flag.String("certfile", "", "Path to a TLS certificate.")
var keyFile = flag.String("keyfile", "", "Path to a private key path.")
var signalingEnabled = flag.Bool("signaling", false, "Advertise to client, we provide RTC signaling.")

var userlist []string          // list of users.
var msgid int = 1              // message id.
var messageCache []MessageData // message cache.
var cacheSize *int = cache     // message cache size.

func main() {
	// serve static assets.
	fs := http.FileServer(http.Dir("html"))
	http.Handle("/", middleware(fs))
	flag.Parse()
	hub := newHub()
	go hub.run()
	events := NewEventManager()
	logger("INFO", "Starting server on", *address)
	msg := "disabled"
	if *signalingEnabled {
		msg = "enabled"
	}
	logger("INFO", "RTC signaling is", msg)

	// login event
	events.On("login", func(c *Client, data []byte) {
		var loginData EventData
		err := json.Unmarshal(data, &loginData)
		if err != nil {
			logger("ERROR", "Failed to parse login data:", err)
			return
		}

		if loginData.Nick == "" {
			forceLogin(c, "Nick can't be empty.")
			return
		}
		// check if user in.
		if checkIfUserIn(loginData.Nick) {
			forceLogin(c, "This nick is already in chat.")
			return
		}

		// now add the user to the list.
		userlist = append(userlist, loginData.Nick)
		logger("DEBUG", "Updated users list:", userlist)

		// Tell this user who is already in.
		startEvent := Event{
			Event: "start",
			Data: EventData{
				Users: userlist,
			},
		}

		startEventJSON, err := json.Marshal(startEvent)
		if err != nil {
			logger("ERROR", "Failed to encode start event:", err)
			return
		}

		logger("DEBUG", "Emitting start event:", string(startEventJSON))
		c.send <- startEventJSON

		// tell everyone "user" entered.
		userEnteredEvent := Event{
			Event: "ue",
			Data: EventData{
				Nick: loginData.Nick,
			},
		}

		userEnteredJSON, err := json.Marshal(userEnteredEvent)
		if err != nil {
			logger("ERROR", "Failed to encode user entered event:", err)
			return
		}

		// save nick.
		c.nick = loginData.Nick
		// emit to everyone except "user".
		for _, client := range c.hub.clients {
			if client != c && client.nick != "" {
				client.send <- userEnteredJSON
			}
		}
		// send message cache to "user".
		cacheEvent := MessageCacheResponse{
			Event: "previous-msg",
			Msgs:  messageCache,
		}

		// dont return nil to the client, give empty array.
		if cacheEvent.Msgs == nil {
			cacheEvent.Msgs = []MessageData{}
		}

		cacheJSON, err := json.Marshal(cacheEvent)
		if err != nil {
			logger("ERROR", "Failed to encode message cache:", err)
			return
		}
		logger("DEBUG", "Emitting previous-msgs event for:", c.nick, "with", len(messageCache), "messages")
		c.send <- cacheJSON
	})

	events.On("send-msg", func(c *Client, data []byte) {
		// if logged in.
		if c.nick == "" {
			forceLogin(c, "You need to be logged in to send a message.")
			logger("INFO", "Ignoring 'send-msg' event: no nickname assigned.")
			return
		}

		logger("DEBUG", "Raw data received:", string(data[:]))
		// structure to decode the incoming message.
		var incomingMessage MessageData
		if err := json.Unmarshal(data, &incomingMessage); err != nil {
			logger("ERROR", "Failed to parse message data:", err)
			return
		}

		logger("DEBUG", "Message content:", incomingMessage.M.Text)

		msgData := MessageData{
			From: c.nick,
			ID:   fmt.Sprintf("msg_%d", msgid),
			M:    incomingMessage.M,
		}

		outgoingMessage := Event{
			Event: "new-msg",
			Data:  msgData,
		}

		msgid++ // Increment msgid.

		if newMessageJSON, err := json.Marshal(outgoingMessage); err == nil {
			logger("DEBUG", "send-msg event triggered for:", c.nick)
			// broadcast to all, except clients without nick
			for _, client := range c.hub.clients {
				if client.nick != "" {
					client.send <- newMessageJSON
				}
			}
			// adds message to cache, pushes out old messages over limit.
			addMessage(msgData)
		} else {
			logger("ERROR", "Failed to encode new-msg event:", err)
		}
	})

	// typing event.
	events.On("typing", func(c *Client, data []byte) {
		var typingStatus bool
		// ignore.
		if c.nick == "" {
			logger("INFO", "Ignoring 'typing' event: no nickname assigned.")
			return
		}

		err := json.Unmarshal(data, &typingStatus)
		if err != nil {
			logger("ERROR", "Failed to parse typing event:", err)
			return
		}

		typingEvent := Event{
			Event: "typing",
			Data: EventData{
				Status: typingStatus,
				Nick:   c.nick,
			},
		}

		typingJSON, err := json.Marshal(typingEvent)
		if err != nil {
			logger("ERROR", "Failed to encode typing event:", err)
			return
		}

		// Broadcast to all clients except the sender.
		for _, client := range c.hub.clients {
			if client != c && client.nick != "" {
				client.send <- typingJSON
			}
		}

		// Log the event.
		action := "is"
		if !typingStatus {
			action = "is not"
		}
		logger("INFO", c.nick, action, "Typing.")
	})

	// We dont really need to trigger this in events, but possible logout process in future? could be useful
	events.On("disconnect", func(c *Client, data []byte) {
		if c.nick != "" {
			logger("DEBUG", "Disconnecting client:", c.nick)
			// remove "user" from the list.
			for i, v := range userlist {
				if v == c.nick {
					userlist = append(userlist[:i], userlist[i+1:]...)
					break
				}
			}
			// Tell everyone, "user" left.
			userLeftEvent := Event{
				Event: "ul",
				Data: EventData{
					Nick: c.nick,
				},
			}

			userLeftJson, err := json.Marshal(userLeftEvent)
			if err != nil {
				logger("ERROR", "Failed to encode user left event:", err)
				return
			}

			c.hub.broadcast <- userLeftJson

			// Remove client from hub.
			c.hub.unregister <- c

			logger("DEBUG", "Removed", c.nick, "from userlist")
		}
	})

	events.On("ping", func(c *Client, data []byte) {
		pingResponse := Event{
			Event: "pong",
		}
		pingJson, err := json.Marshal(pingResponse)
		if err != nil {
			logger("ERROR", "Failed to encode ping response")
			return
		}

		logger("DEBUG", "Pong response sent", string(pingJson))
		c.send <- pingJson
	})

	events.On("signaling-enabled", func(c *Client, data []byte) {
		if c.nick != "" {
			iceServers, err := executeCommandFromFile()
			if err != nil {
				logger("ERROR", "Failed to execute command from file.", err)
			}
			eventData := EventData{
				Enabled:    *signalingEnabled,
				IceServers: iceServers,
			}

			availableEvent := Event{
				Event: "signaling-available",
				Data:  eventData,
			}

			availableJson, err := json.Marshal(availableEvent)
			if err != nil {
				logger("ERROR", "Failed to encode signaling-available event:", err)
				return
			}

			logger("DEBUG", "Signaling available response sent:", string(availableJson))
			c.send <- availableJson
		}
	})

	events.On("ready", func(c *Client, data []byte) {
		if c.nick != "" && *signalingEnabled {
			readyEvent := Event{
				Event: "user-ready",
				Data:  c.id,
			}

			readyJson, err := json.Marshal(readyEvent)
			if err != nil {
				logger("ERROR", "Failed to encode user-ready event:", err)
				return
			}

			logger("DEBUG", "user-ready response sent:", string(readyJson))

			for _, client := range c.hub.clients {
				if client != c && client.nick != "" {
					client.send <- readyJson
				}
			}
		}
	})

	events.On("signal", func(c *Client, data []byte) {
		if c.nick == "" || !*signalingEnabled {
			return
		}

		// decode the signal received from the client
		var signalingData SignalingData
		err := json.Unmarshal(data, &signalingData)
		if err != nil || signalingData.Target == "" || (signalingData.Signal == Signal{}) {
			logger("ERROR", "Invalid signal received from", c.id)
			return
		}

		signalResponse := map[string]interface{}{
			"from":   c.id,
			"signal": signalingData.Signal,
		}

		signalEvent := Event{
			Event: "signal",
			Data:  signalResponse,
		}

		signalResponseJson, err := json.Marshal(signalEvent)
		if err != nil {
			logger("ERROR", "Failed to encode signal for", signalingData.Target)
			return
		}

		// Check if the target client exists before sending.
		targetClient, exists := c.hub.clients[signalingData.Target]
		if !exists {
			logger("ERROR", "Target client not found:", signalingData.Target)
			return
		}

		logger("DEBUG", "Sending signal to:", signalingData.Target, "from:", c.id)

		// Attempt to send the signal to the target client.
		select {
		case targetClient.send <- signalResponseJson:
			// Successfully sent
		default:
			logger("ERROR", "Failed to send signal to:", signalingData.Target)
		}
	})

	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		serveWs(hub, w, r, events)
	})

	// Most are probably behind a proxy, but good practice to provide the option.
	var err error
	if *certFile != "" && *keyFile != "" {
		err = http.ListenAndServeTLS(*address, *certFile, *keyFile, nil)
	} else {
		err = http.ListenAndServe(*address, nil)
	}
	if err != nil {
		logger("ERROR", "ListenAndServe: ", err)
	}
}
