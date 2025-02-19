// File: types.go - Structures used to decode/encode JSON data for WebSocket communication
// Author: @kimboslice99
// Created: 2025-02-15
// Description:
//  - This file contains the data structures used for encoding and decoding JSON messages.
//  - These structures are used for WebSocket communication between the server and clients.
//  - Includes message formats, event data, cache responses, and rtc signaling.

package main

type Message struct {
	Text string `json:"text,omitempty"`
	Type string `json:"type,omitempty"`
	Name string `json:"name,omitempty"`
	Url  string `json:"url,omitempty"`
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

// for encoding, we dont need type assertion, but for decoding, we do.
type MessageEvent struct {
	Event string      `json:"event"`
	Data  interface{} `json:"data,omitempty"`
}

type EventData struct {
	Users  []string `json:"users,omitempty"`
	Status bool     `json:"status,omitempty"`
	Nick   string   `json:"nick,omitempty"`
}

// TODO, probably ditch this struct
type Event struct {
	Event string    `json:"event"`
	Data  EventData `json:"data"`
}

// structures for WebRTC signaling.
type Candidate struct {
	Candidate        string `json:"candidate,omitempty"`
	SdpMid           string `json:"sdpMid,omitempty"`
	SdpMLineIndex    *int   `json:"sdpMLineIndex,omitempty"` // Use pointer to omit when zero
	UsernameFragment string `json:"usernameFragment,omitempty"`
}

type Sdp struct {
	Type string `json:"type,omitempty"`
	Sdp  string `json:"sdp,omitempty"`
}

type Signal struct {
	Candidate *Candidate `json:"candidate,omitempty"` // Pointer allows nil
	Sdp       *Sdp       `json:"sdp,omitempty"`       // Pointer allows nil
}

type SignalingData struct {
	Target string `json:"target"`
	Signal Signal `json:"signal"`
}
