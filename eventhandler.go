// File: eventhandler.go - A custom handler to make main feel more familiar to Socket.IO
// Author: @kimboslice99
// Created: 2025-02-15
// License: GNU General Public License v3.0 (GPLv3)

package main

type EventHandler func(client *Client, data []byte)

type EventManager struct {
	handlers map[string]EventHandler
}

func NewEventManager() *EventManager {
	return &EventManager{
		handlers: make(map[string]EventHandler),
	}
}

func (em *EventManager) On(event string, handler EventHandler) {
	logger("DEBUG", "Registering event:", event)
	em.handlers[event] = handler
}

// so we can call our own registered events
func (em *EventManager) Emit(event string, client *Client, data []byte) {
	if handler, found := em.handlers[event]; found {
		handler(client, data)
	}
}
