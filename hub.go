// Copyright 2013 The Gorilla WebSocket Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// Modified by @kimboslice99, based upon original work by the Gorilla Websocket Authors.
// Original notice retained for attribution and compliance with the BSD license.

package main

// Hub maintains the set of active clients and broadcasts messages to the
// clients.
type Hub struct {
	rooms map[string]map[string]*Client

	// Inbound messages from the clients.
	broadcast chan RoomMessage

	// Register requests from the clients.
	register chan *Client

	// Unregister requests from clients.
	unregister chan *Client
}

type RoomMessage struct {
	RoomID string
	Data   []byte
}

func newHub() *Hub {
	return &Hub{
		broadcast:  make(chan RoomMessage),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		rooms:      make(map[string]map[string]*Client),
	}
}

func (h *Hub) addClientToRoom(client *Client, roomID string) {
	client.roomID = roomID
	h.register <- client
}

func (h *Hub) run() {
	for {
		select {
		case client := <-h.register:
			if _, exists := h.rooms[client.roomID]; !exists {
				h.rooms[client.roomID] = make(map[string]*Client)
			}
			h.rooms[client.roomID][client.id] = client
			logger("DEBUG", "Client", client.id, "joined room", client.roomID)

		case client := <-h.unregister:
			if room, exists := h.rooms[client.roomID]; exists {
				if _, ok := room[client.id]; ok {
					delete(room, client.id)
					close(client.send)
					logger("DEBUG", "Client", client.id, "left room", client.roomID)
				}
				if len(room) == 0 {
					delete(h.rooms, client.roomID) // Cleanup empty rooms
				}
			}

		case message := <-h.broadcast:
			if room, exists := h.rooms[message.RoomID]; exists {
				for _, client := range room {
					select {
					case client.send <- message.Data:
					default:
						close(client.send)
						delete(room, client.id)
					}
				}
			}
		}
	}
}
