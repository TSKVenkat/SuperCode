
const xmlFileRegex = /<file\s+path=["']([^"']+)["'](?:\s+action=["']([^"']+)["'])?[^>]*>([\s\S]*?)<\/file>/gi;

const userExample = `I'll create a simple hello.js program for you. This will be a basic JavaScript file that prints a greeting to the console.

Here's the file:

<file path="src/hello.js"> // A simple greeting program function sayHello(name) { if (name) { console.log(\`Hello, \${name}!\`); } else { console.log('Hello, World!'); } }

// Example usage
sayHello('Clarke Kent');
</file>

This file includes:
`;

console.log("Testing regex against user example...");
let match;
let found = false;
while ((match = xmlFileRegex.exec(userExample)) !== null) {
    found = true;
    console.log("Match found!");
    console.log("Path:", match[1]);
    console.log("Action:", match[2] || "default (write)");
    console.log("Content length:", match[3].length);
    console.log("Content snippet:", match[3].substring(0, 50));
}

if (!found) {
    console.log("No match found!");
}
