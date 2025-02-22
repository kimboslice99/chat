let localStream;
const peerConnections = {};
const iceCandidateQueues = {};
let signalInitalized = false;
let chatIsMuted = false;
let hasMicrophone = false;
let outputId = "default";
let inputId = "default";
const config = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }, // public google STUN server
        // Add TURN server configuration if needed.
        /*
        {
            urls: 'turn:server.com:5349',
            username: 'user',
            credential: 'password'
        }
        */
    ]
};

// Check for available audio input devices
async function checkMediaDevices() {
    console.debug('Checking media devices');
    try {
        // quick check to see if we have a mic to begin with
        const devices = await navigator.mediaDevices.enumerateDevices();
        hasMicrophone = devices.some(device => device.kind === 'audioinput');

        if (hasMicrophone) {
            console.debug('Client has an audio input device.', devices);
            document.getElementById('errorMsg').classList.add('display-none');
            getLocalStream();
        } else {
            console.debug('Client has no audio input device.');
            showError('No microphone found.');
        }
    } catch (e) {
        console.warn(e);
        showError('Unexpected error occured, microphone unavailable.');
    }
}

// Get local media stream
async function getLocalStream() {
    console.debug('Attempting to get local stream with device ID:', inputId);
    try {
        const newStream = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: inputId === "default" ? undefined : { exact: inputId } }
        });

        const newTrack = newStream.getAudioTracks()[0];

        if (!newTrack) {
            console.warn("No audio track found in new stream!");
            return;
        }

        resetLocalAudio(newStream);

        if (localStream) {
            console.debug('Replacing local audio track.');

            // Stop old tracks
            localStream.getTracks().forEach(track => track.stop());

            // Update localStream reference
            localStream = newStream;

            Object.values(peerConnections).forEach(pc => {
                const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
                if (sender) {
                    sender.replaceTrack(newTrack).catch(console.error);
                }
            });
        } else {
            localStream = newStream; // First-time setup
        }

        listenStreamEnded(); // Reattach event listener for disconnections

        // Emit ready unless this is a mic reconnection.
        if (!signalInitalized) {
            socket.emit('ready');
            signalInitalized = true;
        }

        // Show UI
        document.getElementById('errorMsg').classList.add('display-none');
        document.getElementById('audioControls').classList.remove('display-none');

    } catch (error) {
        console.error('Error accessing media devices.', error);
        showError('Error accessing microphone: ' + error.message);
        document.getElementById('audioControls').classList.add('display-none');
    }
}

function resetLocalAudio(newStream) {
    console.debug("Resetting local mic test.");

    const localAudioElement = document.getElementById('localAudio');
    // Stop old tracks before replacing
    if (localAudioElement.srcObject) {
        localAudioElement.srcObject.getTracks().forEach(track => track.stop());
    }

    // Set new audio stream
    localAudioElement.srcObject = newStream;
}

function showError(message) {
    let element = document.getElementById('errorMsg');
    if (element) {
        element.textContent = "";
        let p = document.createElement("p");
        p.innerText = message;
        element.appendChild(p);
        element.classList.remove("display-none");
    }
}

// Wait for Chat to be online
// then ask if server offers rtc signaling
// additionally, we listen for device change event, then check if device is mic.
// we should handle the case where a client has changed microphones, perhaps? TODO
window.addEventListener("chat-active", () => {
    console.debug('Chat is active, asking server if RTC signaling is enabled');
    socket.emit('signaling-enabled');
    socket.once('signaling-available', (enabled) => {
        console.log('RTC Enabled:', enabled);
        if (enabled) {
            checkMediaDevices();
            navigator.mediaDevices.addEventListener("devicechange", checkMediaDevices);
            navigator.mediaDevices.addEventListener("devicechange", populateOptions);
        }
    });

});

/**
 * adds listener for audio input stream end event
 * and fires an event we can reuse elsewhere.
 * 
 * @async
 * @returns {*} 
 */
async function listenStreamEnded() {
    const microphoneStopEvent = new Event('microphonestop');
    const tracks = localStream.getAudioTracks();

    for (const track of tracks) {
      track.addEventListener('ended', () => {
        window.dispatchEvent(microphoneStopEvent);
      });
    }
}

/**
 * Creates a new RTCPeerConnection for a given peer ID and manages media tracks, remote streams, and ICE candidates.
 * 
 * @param {string} id - The unique identifier of the peer.
 * @returns {void} - This function does not return a value.
 */
function createPeerConnection(id) {
    peerConnections[id] = new RTCPeerConnection(config);

    // Add local stream to the connection, this is for the client to test its own audio input device
    if (localStream) {
        localStream.getTracks().forEach(track => peerConnections[id].addTrack(track, localStream));
    }

    // Handle remote stream
    peerConnections[id].ontrack = (event) => {
        const [remoteStream] = event.streams;
        let remoteAudioElement = document.getElementById(id);
        if (!remoteAudioElement) {
            remoteAudioElement = document.createElement('audio');
            remoteAudioElement.id = id;
            remoteAudioElement.autoplay = true;
            remoteAudioElement.muted = chatIsMuted;
            document.getElementById('remoteAudios').appendChild(remoteAudioElement);
        }
        remoteAudioElement.srcObject = remoteStream;
    };

    // Handle ICE candidates
    peerConnections[id].onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('signal', { target: id, signal: { candidate: event.candidate } });
        }
    };
}

// Handle signaling messages
socket.on('signal', async (data) => {
    const { from, signal } = data; // Extract sender ID and signal data

    // Check if we've already established a peer connection with this client
    if (!peerConnections[from]) {
        createPeerConnection(from); // Create a new peer connection if it doesn't exist
    }

    // If the signal contains an SDP (Session Description Protocol) message
    if (signal.sdp) {
        await peerConnections[from].setRemoteDescription(new RTCSessionDescription(signal.sdp));

        // If the received SDP is an offer, respond with an answer
        if (signal.sdp.type === 'offer') {
            const answer = await peerConnections[from].createAnswer(); // Create an SDP answer
            await peerConnections[from].setLocalDescription(answer); // Set the local description with the answer

            // Send the answer back to the originating peer
            socket.emit('signal', { target: from, signal: { sdp: peerConnections[from].localDescription } });
        }

        // Add any ICE candidates that were queued while waiting for the remote description
        if (iceCandidateQueues[from]) {
            iceCandidateQueues[from].forEach(candidate => {
                peerConnections[from].addIceCandidate(new RTCIceCandidate(candidate));
            });
            
            // Clear the queue after processing
            delete iceCandidateQueues[from];
        }
    }
    // If the signal contains an ICE candidate
    else if (signal.candidate) {
        // If the remote description is already set, add the ICE candidate immediately
        if (peerConnections[from].remoteDescription) {
            await peerConnections[from].addIceCandidate(new RTCIceCandidate(signal.candidate));
        } else {
            // Otherwise, store the candidate in a queue to be added later
            if (!iceCandidateQueues[from]) {
                iceCandidateQueues[from] = [];
            }
            iceCandidateQueues[from].push(signal.candidate);
        }
    }
});

// Handle when a new user is ready to connect
socket.on('user-ready', async (id) => {
    // Check if we already have a peer connection with this user; if not, create one
    if (!peerConnections[id]) {
        createPeerConnection(id);
    }

    try {
        const offer = await peerConnections[id].createOffer();
        await peerConnections[id].setLocalDescription(offer);

        Chat.socket.emit('signal', {
            target: id, signal: { sdp: peerConnections[id].localDescription }
        });
    } catch (error) {
        console.error(error);
    }
});

// Handle user disconnected
socket.on('ul', (data) => {
    const { nick, id } = data;

    if (peerConnections[id]) {
        peerConnections[id].close();
        delete peerConnections[id];
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
    console.debug('Microphone lost.');
    showError('No microphone found.');
});

// For client to test their microphone.
function toggleMicPlayback() {
    const localAudioElement = document.getElementById('localAudio');
    localAudioElement.muted = !localAudioElement.muted;
    console.debug(`Local microphone playback is ${localAudioElement.muted ? 'disabled' : 'enabled'}`);
}

function toggleMicMute() {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        audioTrack.enabled = !audioTrack.enabled;
        console.log(`Microphone is ${audioTrack.enabled ? 'unmuted' : 'muted'}`);
    }
}

function muteChat() {
    chatIsMuted = !chatIsMuted;
    const remoteAudioElements = document.querySelectorAll('#remoteAudios audio');
    // mute each remote stream.
    remoteAudioElements.forEach(remoteAudioElement => {
        remoteAudioElement.muted = chatIsMuted;
    });
    console.log(`Chat is ${chatIsMuted ? 'muted' : 'unmuted'}`);
}

async function populateOptions(){
    addOptions('mic-select');
    addOptions('output-select', false);
}

async function addOptions(id, input = true) {
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
        selectElement.addEventListener("change", (event) => {
            const selectedDeviceId = event.target.value;
            console.debug(`Selected input device: ${selectedDeviceId}`);
            inputId = selectedDeviceId;
            getLocalStream();
        });
    } else {
        selectElement.addEventListener("change", async (event) => {
            const selectedDeviceId = event.target.value;
            console.debug(`Selected output device: ${selectedDeviceId}`);
            outputId = selectedDeviceId;

            const localAudioElement = document.getElementById('localAudio');
            if (localAudioElement.setSinkId) {
                try {
                    await localAudioElement.setSinkId(outputId);
                    updateRemoteAudioSink();
                    console.debug(`Audio output changed to ${outputId}`);
                } catch (e) {
                    console.warn("Failed to change audio output:", e);
                }
            } else {
                console.warn("setSinkId is not supported in this browser.");
            }
        });
    }
}

async function updateRemoteAudioSink(){
    const remoteAudioElements = document.querySelectorAll('#remoteAudios audio');
    if(!remoteAudioElements) return;

    remoteAudioElements.forEach(element => {
        element.setSinkId(outputId);
    })
}

document.getElementById('toggleMicPlayback').addEventListener('click', toggleMicPlayback);
document.getElementById('toggleMicMute').addEventListener('click', toggleMicMute);
document.getElementById('muteChat').addEventListener('click', muteChat);
populateOptions();
