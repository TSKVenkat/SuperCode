
// Mock Parser Logic to test Regex
class AgenticResponseParser {
    constructor(logService) { }

    parseResponse(response) {
        const actions = [];
        let position = 0;

        // Parse <git-command> or <command> XML-style blocks
        // Format: <git-command>content</git-command>
        const commandRegex = /<(?:git-)?command>([\s\S]*?)<\/(?:git-)?command>/gi;
        let match;

        while ((match = commandRegex.exec(response)) !== null) {
            const command = match[1].trim();
            if (command) {
                actions.push({
                    type: 'run_command',
                    command: command,
                    position: position++
                });
            }
        }

        return { actions };
    }
}

const userExample = `I'll commit and push the changes. Here's the commit message:

<git-command> git add src/components/Chat/UserPresence.css git commit -m "Update UserPresence.css with complete styling for avatar stack, status indicators, and hover effects" git push </git-command>

The changes have been committed and pushed to your repository.`;

console.log("Testing parser against user example...");
const parser = new AgenticResponseParser();
const result = parser.parseResponse(userExample);

console.log("Actions found:", result.actions.length);
result.actions.forEach(action => {
    console.log("Action Type:", action.type);
    console.log("Command:", action.command);
});

if (result.actions.length === 0) {
    console.log("FAIL: No actions detected!");
} else {
    console.log("SUCCESS: Actions detected.");
}
