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

func (em *EventManager) Emit(event string, client *Client, data []byte) {
	if handler, found := em.handlers[event]; found {
		handler(client, data)
	}
}
