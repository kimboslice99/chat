var WebRTC = {
    secure: location.protocol == "https:" ? true : false,
    localStream: null,
    peerConnections: {},
    iceCandidateQueues: {},
    signalInitalized: false,
    chatIsMuted: false,
    hasMicrophone: false,
    outputId: "default",
    inputId: "default",
    constraints: {
        audio: {
        autoGainControl: true,
        noiseSuppression: true,
        echoCancellation: false,
        sampleRate: 48000,
        }
    },
    config: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' }, // public google STUN server
        ]
    },

    // Check for available audio input devices
    checkMediaDevices: async function() {
        try {
            // quick check to see if we have a mic to begin with
            const devices = await navigator.mediaDevices.enumerateDevices();
            this.hasMicrophone = devices.some(device => device.kind === 'audioinput');

            if (this.hasMicrophone) {
                console.debug('Client has an audio input device.', devices);
                document.getElementById('errorMsg').classList.add('display-none');
                this.getLocalStream();
            } else {
                console.debug('Client has no audio input device.');
                this.showError('No microphone found.');
            }
        } catch (e) {
            console.warn(e);
            this.showError('Unexpected error occured, microphone unavailable.');
        }
    },

    // Get local media stream
    getLocalStream: async function() {
        console.debug('Attempting to get local stream with device ID:', this.inputId);
        try {
            const newStream = await navigator.mediaDevices.getUserMedia({
                audio: this.inputId === "default" ? this.constraints.audio : { ...this.constraints.audio, deviceId: { exact: this.inputId } }
            });

            const newTrack = newStream.getAudioTracks()[0];

            if (!newTrack) {
                console.warn("No audio track found in stream!");
                return;
            }

            this.resetLocalAudio(newStream);

            if (this.localStream) {
                console.debug('Replacing local audio track.');

                // Stop old tracks
                this.localStream.getTracks().forEach(track => track.stop());

                // Update localStream reference
                this.localStream = newStream;

                Object.values(this.peerConnections).forEach(pc => {
                    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
                    if (sender) {
                        sender.replaceTrack(newTrack).catch(console.error);
                    }
                });
            } else {
                this.localStream = newStream; // First-time setup
            }

            this.listenStreamEnded(); // Reattach event listener for disconnections
            this.setStreamOptions();

            // Emit ready unless this is a mic reconnection.
            if (!this.signalInitalized) {
                Chat.send({ event: 'ready' });
                this.signalInitalized = true;
            }

            // Show UI
            document.getElementById('errorMsg').classList.add('display-none');
            document.getElementById('audioControls').classList.remove('display-none');

        } catch (error) {
            console.error('Error accessing media devices.', error);
            this.showError('Error accessing microphone: ' + error);
        }
    },

    resetLocalAudio: function(newStream) {
        console.debug("Resetting local mic test.");

        const localAudioElement = document.getElementById('localAudio');
        // Stop old tracks before replacing
        if (localAudioElement.srcObject) {
            localAudioElement.srcObject.getTracks().forEach(track => track.stop());
        }

        // Set new audio stream
        localAudioElement.srcObject = newStream;
    },

    showError: function(message) {
        let element = document.getElementById('errorMsg');
        if (element) {
            element.textContent = "";
            let p = document.createElement("p");
            p.innerText = message;
            element.appendChild(p);
            element.classList.remove("display-none");
        }
    },

    /**
     * This function merges the static config with a server provided config.
     * @param {*} baseConfig 
     * @param {*} newConfig 
     * @returns The merged array, or base config if server did not provide one.
     */
    mergeIceServers: (baseConfig, newConfig) => {
        if (!newConfig?.iceServers?.length) {
            console.warn("Invalid ICE config received, using base config.", newConfig);
            return baseConfig;
        }

        return { iceServers: [...baseConfig.iceServers, ...newConfig.iceServers] };
    },

    init(){
        // Wait for Chat to be online
        // then ask if server offers rtc signaling
        window.addEventListener("chat-active", () => {
            Chat.send({ event: "signaling-enabled" });
        }),

        window.addEventListener("signaling-available", (event) => {
            console.info(event.data.enabled === true ? "Server offers RTC Signaling" : "Server does not offer RTC signaling");
            if (!this.secure) {
                console.log('WebRTC requires a secure connection (HTTPS).');
                this.showError('WebRTC cannot be enabled on an insecure connection.');
                return;
            }
            if (event.data.enabled === true) {
                this.checkMediaDevices();
                navigator.mediaDevices.addEventListener("devicechange", () => this.checkMediaDevices());
                navigator.mediaDevices.addEventListener("devicechange", () => this.populateOptions());
            }
            if (event.data.iceServers && event.data.iceServers.length > 0) {
                this.config = this.mergeIceServers(this.config, event.data);
                console.debug('Merged config from server', this.config);
            } else {
                console.debug('Server did not provide TURN config, relying on STUN servers only.');
            }
        })
        
        // Handle signaling messages
        window.addEventListener("signal", async (event) => {
            console.debug('signal received with data:', event.data);
            const { from, signal } = event.data; // Extract sender ID and signal data

            // Check if we've already established a peer connection with this client
            if (!this.peerConnections[from]) {
                this.createPeerConnection(from); // Create a new peer connection if it doesn't exist
                console.debug('Added peer connection for:', from);
            }

            // If the signal contains an SDP (Session Description Protocol) message
            if (signal.sdp) {
                console.debug('Recieved sdp signal');
                await this.peerConnections[from].setRemoteDescription(new RTCSessionDescription(signal.sdp));

                // If the received SDP is an offer, respond with an answer
                if (signal.sdp.type === 'offer') {
                    const answer = await this.peerConnections[from].createAnswer(); // Create an SDP answer
                    await this.peerConnections[from].setLocalDescription(answer); // Set the local description with the answer

                    // Send the answer back to the originating peer
                    Chat.send({ event: 'signal', data: { target: from, signal: { sdp: this.peerConnections[from].localDescription } } });
                }

                // Add any ICE candidates that were queued while waiting for the remote description
                if (this.iceCandidateQueues[from]) {
                    this.iceCandidateQueues[from].forEach(candidate => {
                        this.peerConnections[from].addIceCandidate(new RTCIceCandidate(candidate));
                    });
                    
                    // Clear the queue after processing
                    delete this.iceCandidateQueues[from];
                }
            }
            // If the signal contains an ICE candidate
            else if (signal.candidate) {
                console.debug('Signal recieved was candidate');
                // If the remote description is already set, add the ICE candidate immediately
                if (this.peerConnections[from].remoteDescription) {
                    await this.peerConnections[from].addIceCandidate(new RTCIceCandidate(signal.candidate));
                } else {
                    // Otherwise, store the candidate in a queue to be added later
                    if (!this.iceCandidateQueues[from]) {
                        this.iceCandidateQueues[from] = [];
                    }
                    this.iceCandidateQueues[from].push(signal.candidate);
                }
            }
        });

        window.addEventListener("user-ready", async (event) => {
            console.debug('user-ready fired for id', event.id);
            const id = event.id;
            if (!this.peerConnections[id]) {
                this.createPeerConnection(id);
            }

            try {
                const offer = await this.peerConnections[id].createOffer();
                await this.peerConnections[id].setLocalDescription(offer);

                Chat.send({
                    event: 'signal',
                    data: { target: id, signal: { sdp: this.peerConnections[id].localDescription } }
                });
            } catch (error) {
                console.error(error);
            }
        });

        // Handle user disconnected
        window.addEventListener('ul', (data) => {
            console.debug("webrtc ul event", data);
            const { nick, id } = data;

            if (this.peerConnections[id]) {
                this.peerConnections[id].close();
                delete this.peerConnections[id];
                const remoteAudioElement = document.getElementById(id);
                if (remoteAudioElement) {
                    remoteAudioElement.remove();
                }
            } else {
                console.debug('Peer connection not found, nothing to remove', id);
            }
        });

        window.addEventListener('microphonestop', () => {
            document.getElementById('audioControls').classList.add('display-none');
            console.debug('Microphone lost, reverting to default.');
            this.showError('No microphone found.');
            // mic lost, revert to default
            this.inputId = "default";
        });
        
        document.getElementById('toggleMicPlayback').addEventListener('click', () => this.toggleMicPlayback());
        document.getElementById('toggleMicMute').addEventListener('click', () => this.toggleMicMute());
        document.getElementById('muteChat').addEventListener('click', () => this.muteChat());
        this.populateOptions();
    },

    /**
     * adds listener for audio input stream end event
     * and fires an event we can reuse elsewhere.
     * 
     * @async
     * @returns {*} 
     */
    listenStreamEnded: async function() {
        const microphoneStopEvent = new Event('microphonestop');
        const tracks = this.localStream.getAudioTracks();

        for (const track of tracks) {
        track.addEventListener('ended', () => {
            window.dispatchEvent(microphoneStopEvent);
        });
        }
    },

    /**
     * Creates a new RTCPeerConnection for a given peer ID and manages media tracks, remote streams, and ICE candidates.
     * 
     * @param {string} id - The unique identifier of the peer.
     * @returns {void} - This function does not return a value.
     */
    async createPeerConnection(id) {
        this.peerConnections[id] = new RTCPeerConnection(this.config);

        // Add local stream to the connection
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => peerConnections[id].addTrack(track, this.localStream));
        }

        // Handle remote stream
        this.peerConnections[id].ontrack = async (event) => {
            const [remoteStream] = event.streams;
            let remoteAudioElement = document.getElementById(id);
            if (!remoteAudioElement) {
                remoteAudioElement = document.createElement('audio');
                remoteAudioElement.id = id;
                remoteAudioElement.autoplay = true;
                remoteAudioElement.muted = this.chatIsMuted;
                document.getElementById('remoteAudios').appendChild(remoteAudioElement);
            }
            try {
                await remoteAudioElement.setSinkId(this.outputId);
            } catch(e) {
                // browser may not support it.
                console.warn(e);
            }
            remoteAudioElement.srcObject = remoteStream;
        };

        // Handle ICE candidates
        this.peerConnections[id].onicecandidate = (event) => {
            if (event.candidate) {
                Chat.send({ event: 'signal', data: { target: id, signal: { candidate: event.candidate } } });
            }
        };

        this.setStreamOptions();
    },


    // For client to test their microphone.
    toggleMicPlayback() {
        const localAudioElement = document.getElementById('localAudio');
        localAudioElement.muted = !localAudioElement.muted;
        console.debug(`Local microphone playback is ${localAudioElement.muted ? 'disabled' : 'enabled'}`);
    },

    toggleMicMute() {
        if (this.localStream) {
            const audioTrack = this.localStream.getAudioTracks()[0];
            audioTrack.enabled = !audioTrack.enabled;
            console.log(`Microphone is ${audioTrack.enabled ? 'unmuted' : 'muted'}`);
        }
    },

    muteChat() {
        this.chatIsMuted = !this.chatIsMuted;
        const remoteAudioElements = document.querySelectorAll('#remoteAudios audio');
        // mute each remote stream.
        remoteAudioElements.forEach(remoteAudioElement => {
            remoteAudioElement.muted = this.chatIsMuted;
        });
        console.log(`Chat is ${this.chatIsMuted ? 'muted' : 'unmuted'}`);
    },

    populateOptions: function() {
        this.addOptions('mic-select');
        this.addOptions('output-select', false);
    },

    addOptions: async function(id, input = true) {
        let selectElement = document.getElementById(id);
        if (!selectElement) return;

        const devices = await navigator.mediaDevices.enumerateDevices();

        const filteredDevices = devices.filter(device => 
            input ? device.kind === 'audioinput' : device.kind === 'audiooutput'
        );

        // Clear existing options
        selectElement.innerHTML = "";

        // Populate the select element with filtered devices
        filteredDevices.forEach(device => {
            let opt = document.createElement('option');
            opt.innerText = device.label || `Device ${device.deviceId}`;
            opt.value = device.deviceId;
            selectElement.appendChild(opt);
        });

        if (input) {
            selectElement.onchange = async (event) => {
                const selectedDeviceId = event.target.value;
                console.debug(`Selected input device: ${selectedDeviceId}`);
                this.inputId = selectedDeviceId;
                this.getLocalStream();
            };
        } else {
            selectElement.onchange = async (event) => {
                const selectedDeviceId = event.target.value;
                console.debug(`Selected output device: ${selectedDeviceId}`);
                this.outputId = selectedDeviceId;
                const localAudioElement = document.getElementById('localAudio');

                if (localAudioElement.setSinkId) {
                    try {
                        // virtual devices such as "communications" need to be mapped to their real ID
                        if (this.outputId === "communications") {
                            const commDevice = filteredDevices.find(d => d.deviceId === "communications");

                            if (commDevice && commDevice.groupId) {
                                const realDevice = devices.find(d =>
                                    d.kind === "audiooutput" &&
                                    d.deviceId !== "communications" &&
                                    d.groupId === commDevice.groupId
                                );

                                if (realDevice) {
                                    console.warn(`Remapping "communications" to real device: ${realDevice.label}`);
                                    this.outputId = realDevice.deviceId;
                                } else {
                                    console.warn(`No matching real device for "communications", keeping default.`);
                                    this.outputId = "default";
                                }
                            }
                        }
                        // update our mic test element to use the selected audio output device.
                        await localAudioElement.setSinkId(this.outputId);
                        // update the remote audio elements as well.
                        await this.updateRemoteAudioSink();
                        console.debug(`Audio output changed to ${this.outputId}`);
                    } catch (e) {
                        console.warn("Failed to change audio output:", e);
                    }
                } else {
                    console.warn("setSinkId is not supported in this browser.");
                }
            };
        }
    },

    updateRemoteAudioSink: async function(){
        console.debug('updateRemoteAudioSink()', this.outputId);
        const remoteAudioElements = document.querySelectorAll('#remoteAudios audio');
        if(!remoteAudioElements) return;
        for (const element of remoteAudioElements) {
            try {
                await element.setSinkId(this.outputId);
                console.debug(`Updated audio sink to ${this.outputId}`);
            } catch (e) {
                console.warn("Failed to update audio sink:", e);
            }
        }
    },

    setStreamOptions: function() {
        Object.values(this.peerConnections).forEach(pc => {
            if (!pc) return;

            const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
            if (sender) {
                const params = sender.getParameters();
                if (!params.encodings.length) {
                    params.encodings = [{}];
                }

                params.encodings[0].maxBitrate = 50 * 1000; // 50 kbps

                try {
                    sender.setParameters(params);
                    console.debug('Updated sender parameters:', params);
                } catch (err) {
                    console.warn('Failed to set sender parameters:', err);
                }
            }
        });
    }
}