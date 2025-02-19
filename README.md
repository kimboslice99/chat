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
        Advertise to client, we provide RTC signaling. (default false)
```

## How to build

```cmd
git clone https://github.com/kimboslice99/chat
cd chat
go mod tidy
go build
./chat
```
