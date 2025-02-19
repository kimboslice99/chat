// Copyright 2013 The Gorilla WebSocket Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// Modified by @kimboslice99, based upon original work by the Gorilla Websocket Authors.
// Original notice retained for attribution and compliance with the BSD license.

package main

// Hub maintains the set of active clients and broadcasts messages to the
// clients.
type Hub struct {
	// Registered clients.
	clients map[string]*Client

	// Inbound messages from the clients.
	broadcast chan []byte

	// Register requests from the clients.
	register chan *Client

	// Unregister requests from clients.
	unregister chan *Client
}

func newHub() *Hub {
	return &Hub{
		broadcast:  make(chan []byte),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		clients:    make(map[string]*Client),
	}
}

func (h *Hub) run() {
	for {
		select {
		case client := <-h.register:
			// Register a new client
			h.clients[client.id] = client // Use the client's unique ID as the key
			logger("DEBUG", "Client connected:", client.id)

		case client := <-h.unregister:
			// Remove client on disconnect
			if _, ok := h.clients[client.id]; ok {
				delete(h.clients, client.id)
				close(client.send)
				logger("DEBUG", "Client disconnected:", client.id)
			}

		case message := <-h.broadcast:
			// Broadcast messages to all clients
			for _, client := range h.clients {
				select {
				case client.send <- message:
				default:
					// If client buffer is full, remove it
					close(client.send)
					delete(h.clients, client.id)
				}
			}
		}
	}
}
