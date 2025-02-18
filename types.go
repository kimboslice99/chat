// File: types.go - Structures used to decode/encode JSON data for WebSocket communication
// Author: @kimboslice99
// Created: 2025-02-15
// Description:
//  - This file contains the data structures used for encoding and decoding JSON messages.
//  - These structures are used for WebSocket communication between the server and clients.
//  - Includes message formats, event data, and cache responses.

package main

type Message struct {
	Text string `json:"text"`
	Type string `json:"type"`
	Name string `json:"name"`
	Url  string `json:"url"`
}

type MessageData struct {
	From string  `json:"f"`
	ID   string  `json:"id"`
	M    Message `json:"m"`
}

type MessageDataEvent struct {
	Event string      `json:"event"`
	Data  MessageData `json:"data"`
}

type MessageCacheResponse struct {
	Event string        `json:"event"`
	Msgs  []MessageData `json:"msgs"`
}

type MessageEvent struct {
	Event string `json:"event"`
	Data  string `json:"data"`
}

type EventData struct {
	Users  []string `json:"users"`
	Status bool     `json:"status"`
	Nick   string   `json:"nick"`
}

type Event struct {
	Event string    `json:"event"`
	Data  EventData `json:"data"`
}
