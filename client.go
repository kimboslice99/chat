// Copyright 2013 The Gorilla WebSocket Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// Modified by @kimboslice99.
// Original notice retained for attribution and compliance with the BSD license.

package main

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/fasthttp/websocket"
	"github.com/google/uuid"
)

const (
	// Time allowed to write a message to the peer.
	writeWait = 10 * time.Second

	// Time allowed to read the next pong message from the peer.
	pongWait = 60 * time.Second

	// Send pings to peer with this period. Must be less than pongWait.
	pingPeriod = (pongWait * 9) / 10
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

type Client struct {
	hub    *Hub
	conn   *websocket.Conn
	send   chan []byte
	events *EventManager
	nick   string
	id     string
}

// readPump pumps messages from the websocket connection to the hub.
//
// The application runs readPump in a per-connection goroutine. The application
// ensures that there is at most one reader on a connection by executing all
// reads from this goroutine.
func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()
	c.conn.SetReadLimit(*maxMessageSize * 1024 * 1024)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, msg, err := c.conn.ReadMessage()
		if err != nil {
			c.hub.unregister <- c
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				logger("ERROR", err)
			}
			// emit disconnect event
			if c.events != nil {
				c.events.Emit("disconnect", c, nil)
			}
			break
		}

		// Parse the event, leave the data for our handler
		var message struct {
			Event string          `json:"event"`
			Data  json.RawMessage `json:"data"`
		}

		if err := json.Unmarshal(msg, &message); err != nil {
			logger("ERROR", "Invalid message format:", err)
			continue
		}

		logger("DEBUG", "Parsed Event:", message.Event)
		logger("DEBUG", "Raw Data:", string(message.Data))

		// Check if the event exists before calling it
		if handler, exists := c.events.handlers[message.Event]; exists {
			logger("DEBUG", "Emitting event:", message.Event)
			handler(c, message.Data)
		} else {
			logger("DEBUG", "Event not found:", message.Event)
		}
	}
}

// writePump pumps messages from the hub to the websocket connection.
//
// A goroutine running writePump is started for each connection. The
// application ensures that there is at most one writer to a connection by
// executing all writes from this goroutine.
func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// Hub closed the channel
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			err := c.conn.WriteMessage(websocket.TextMessage, message)
			if err != nil {
				logger("ERROR", "Failed to send WebSocket message:", err)
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// serveWs handles websocket requests from the peer.
func serveWs(hub *Hub, w http.ResponseWriter, r *http.Request, events *EventManager) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println(err)
		return
	}
	client := &Client{
		hub:    hub,
		conn:   conn,
		send:   make(chan []byte, 256),
		events: events,
		id:     uuid.NewString(),
	}
	client.hub.register <- client

	// Allow collection of memory referenced by the caller by doing all work in
	// new goroutines.
	go client.writePump()
	go client.readPump()
}
