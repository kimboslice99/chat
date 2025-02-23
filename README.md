# Chat

A simple plug & play real-time JavaScript chat server, now ported to Golang for better performance and compatibility with embedded devices.

Where simplicity meets usability:

* No user accounts - just enter nickname and join.
* No history saved by default - only logged-in users can see recent history.
* No configuration.
* Only one room - you can't create any other rooms or write PM to others.
* Files sharing is possible - without storing any data on server.
* Emojis - just a few of them.

![screenshot](https://raw.githubusercontent.com/m1k1o/chat/master/screenshot.png)

## Configuration

The server accepts the following command-line arguments:

```plain
Usage:
  -bind string
        bind service to address. (default ":8090")
  -cache int
        Message cache size. (default 0)
  -log string
        Log level (DEBUG, INFO, ERROR). (default "INFO")
  -certfile string
        Path to a TLS certificate.
  -keyfile string
        Path to a private key path.
  -readlimit int
        Maximum message size in MB. (default 1)
  -signaling
        Advertise to client, we provide RTC signaling.
```

## How to build

```cmd
git clone https://github.com/kimboslice99/chat
cd chat
go mod tidy
go build
./chat
```

## Cache

`CACHE_SIZE` is optional and determines the number of messages stored on the server. When new users join (or reconnect), that cache is sent to give a brief history. This defaults to zero, but can be set as an environment variable.

If you're not running in a docker container, you can make a `.env` file in the project root with `CACHE_SIZE=50` in.

Note: This cache will be text or images so be mindful not to set it too high as it could be n images sent to every new user.

## WebRTC Signaling

WebRTC signaling can be enabled by setting `CHAT_SIGNALING_ENABLED` environment variable.

A TURN server is required for clients that do not share a suitable network protocol (ie: IPv4 only client cannot communicate with an IPv6 only client). For the most part, STUN is all thats required to get things working, a public STUN server has been provided already so this configuration is not strictly necessary.

To provide your clients with short term tokens for a TURN server, enter a command into the `.command` file, the command should make an API request to your turn provider and return the credentials structured as follows.

```json
[
  {
    "urls": "",
    "username": "",
    "credential": ""
  },
  {
    "urls": "",
    "username": "",
    "credential": ""
  }
]
```

A couple of powershell scripts have been provided to make things easier. Currently just metered and CF.
