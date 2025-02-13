let localStream;
const peerConnections = {};
const iceCandidateQueues = {};
let chatIsMuted = false;
let hasMicrophone = false;
const config = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }, // public google STUN server
        // Add TURN server configuration if needed
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
    const devices = await navigator.mediaDevices.enumerateDevices();
    hasMicrophone = devices.some(device => device.kind === 'audioinput');

    if (hasMicrophone) {
        console.debug('Client has an audio input device.', devices);
        document.getElementById('errorMsg').classList.add('display-none');
        getLocalStream();
    } else {
        console.debug('Client has no audio input device.');
        showError('No microphone found.');
        setTimeout(checkMediaDevices, 1000);
    }
}

// Get local media stream
async function getLocalStream() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // assign stream to localAudio so client can test own microphone.
        document.getElementById('localAudio').srcObject = stream;
        localStream = stream;
        socket.emit('ready');
        // show the controls since our client has a microphone and has allowed voice permission.
        document.getElementById('errorMsg').classList.add('display-none');
        document.getElementById('audioControls').classList.remove('display-none');
    } catch (error) {
        // user denied access to microphone (or perhaps browser).
        console.error('Error accessing media devices.', error);
        showError('Error accessing microphone: ' + error.message);
    }
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

function waitForCondition(condition, callback) {
    if (condition()) {
        callback();
    } else {
        setTimeout(() => waitForCondition(condition, callback), 1000);
    }
}

function isRTCEnabled(callback) {
    socket.emit('is-rtc-enabled');
    socket.once('rtc-enabled', (enabled) => {
        callback(enabled);
    });
}

// Wait for Chat to be online
// then ask if server offers rtc signalling
// additionally, we keep polling for microphone if none found, user may plug one in afterwards
// we should handle the case where a client has changed microphones, perhaps? TODO
waitForCondition(() => Chat.is_online, () => {
    isRTCEnabled((enabled) => {
        console.log('RTC Enabled:', enabled);
        if (enabled) {
            checkMediaDevices();
        }
    });
});

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
socket.on('user-ready', (id) => {
    // Check if we already have a peer connection with this user; if not, create one
    if (!peerConnections[id]) {
        createPeerConnection(id);
    }

    // Create an SDP offer to initiate the WebRTC connection
    peerConnections[id].createOffer()
        .then((offer) => {
            return peerConnections[id].setLocalDescription(offer); // Set the local SDP description
        })
        .then(() => {
            // Send the offer to the new user via signaling
            socket.emit('signal', { target: id, signal: { sdp: peerConnections[id].localDescription } });
        })
        .catch(console.error); // Log any errors that occur during the process
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

// For client to test their microphone.
function toggleMicPlayback() {
    const localAudioElement = document.getElementById('localAudio');
    localAudioElement.muted = !localAudioElement.muted;
    console.log(`Local microphone playback is ${localAudioElement.muted ? 'disabled' : 'enabled'}`);
}

function toggleMicMute() {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        audioTrack.enabled = !audioTrack.enabled;
        console.log(`Microphone is ${audioTrack.enabled ? 'unmuted' : 'muted'}`);
    }
}

// Mute chat function
function muteChat() {
    chatIsMuted = !chatIsMuted; // toggle
    const remoteAudioElements = document.querySelectorAll('#remoteAudios audio');
    remoteAudioElements.forEach(remoteAudioElement => {
        remoteAudioElement.muted = chatIsMuted;
    });
    console.log(`Chat is ${chatIsMuted ? 'muted' : 'unmuted'}`);
}

document.getElementById('toggleMicPlayback').addEventListener('click', toggleMicPlayback);
document.getElementById('toggleMicMute').addEventListener('click', toggleMicMute);
document.getElementById('muteChat').addEventListener('click', muteChat);
