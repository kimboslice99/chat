const fs = require('fs').promises;

module.exports = {
    /**
     * This function runs command from file and returns the response
     * This is so that our signaling server can provide short-term tokens to chat clients
     * without being too integrated with any one TURN/STUN provider.
     * @returns 
     */
    executeCommandFromFile: async function() {
        try {
            // Read the command from the file
            const data = await fs.readFile(".command", "utf8");
            const commandStr = data.trim();

            if (!commandStr) {
                console.log("No command found in the file");
                return {};
            }

            // Execute the command
            const { exec } = require("child_process");
            const output = await new Promise((resolve, reject) => {
                exec(commandStr, (error, stdout, stderr) => {
                    if (error) {
                        return reject(`Error executing command: ${stderr || error.message}`);
                    }
                    resolve(stdout);
                });
            });

            // Parse JSON output
            return JSON.parse(output);
        } catch (error) {
            console.log(`Failed: ${error}`);
            return {};
        }
    }
}
