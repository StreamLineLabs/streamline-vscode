# Streamline for VS Code

[![CI](https://github.com/streamlinelabs/streamline-vscode/actions/workflows/ci.yml/badge.svg)](https://github.com/streamlinelabs/streamline-vscode/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![VS Code](https://img.shields.io/badge/VS_Code-Extension-007ACC.svg)](https://marketplace.visualstudio.com/)

Official VS Code extension for Streamline streaming platform.

## Features

- **Topic Browser**: View and manage topics directly in VS Code
- **Message Preview**: Browse messages with JSON formatting
- **Consumer Groups**: Monitor consumer group status and lag
- **Quick Produce**: Send test messages without leaving your editor
- **Schema Validation**: Validate messages against registered schemas

## Installation

1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "Streamline"
4. Click Install

Or install from the command line:

```bash
code --install-extension streamline.streamline-vscode
```

## Quick Start

1. Open the Streamline view in the Activity Bar
2. Click "Connect to Server" or use `Ctrl+Shift+P` → "Streamline: Connect"
3. Enter your server address (default: `localhost:9092`)
4. Browse topics in the tree view

## Commands

| Command | Description |
|---------|-------------|
| `Streamline: Connect` | Connect to a Streamline server |
| `Streamline: Disconnect` | Disconnect from current server |
| `Streamline: Create Topic` | Create a new topic |
| `Streamline: View Messages` | Open message viewer for a topic |
| `Streamline: Produce Message` | Send a message to a topic |
| `Streamline: Refresh Topics` | Refresh the topic list |
| `Streamline: Register Schema` | Register a new schema |
| `Streamline: View Schema` | View schema details |
| `Streamline: Check Compatibility` | Check schema compatibility |
| `Streamline: Set Compatibility Level` | Set subject compatibility level |
| `Streamline: Delete Subject` | Delete all versions of a subject |

## Configuration

Configure in VS Code settings (`settings.json`):

```json
{
  "streamline.serverAddress": "localhost:9092",
  "streamline.httpAddress": "localhost:9094",
  "streamline.autoRefresh": true,
  "streamline.refreshInterval": 5000,
  "streamline.maxMessages": 100,
  "streamline.theme": "auto",
  "streamline.autoReconnect": true,
  "streamline.autoReconnectInterval": 5000,
  "streamline.connections": [
    {
      "name": "local",
      "host": "localhost",
      "port": 9092,
      "httpPort": 9094
    },
    {
      "name": "production",
      "host": "streamline.example.com",
      "port": 9092,
      "httpPort": 9094,
      "tls": true,
      "tlsCaCert": "/path/to/ca.pem"
    }
  ],
  "streamline.defaultConnection": "local"
}
```

### Message Validation

Validate messages before producing by setting a JSON Schema:

```json
{
  "streamline.produceMessageSchema": {
    "type": "object",
    "required": ["id", "event"],
    "properties": {
      "id": { "type": "string" },
      "event": { "type": "string" },
      "timestamp": { "type": "number" }
    }
  }
}
```

## Views

### Topics View

- Lists all topics with partition count
- Right-click for context menu actions
- Expand topics to see partitions

### Consumer Groups View

- Shows all consumer groups
- Displays member count and state
- View lag per partition

### Schema Registry View

- Browse all schema subjects
- View schema versions and definitions
- Check schema compatibility
- Register new schemas
- Manage compatibility levels

### Connections View

- Manage saved connections
- Quick-switch between environments

## Message Viewer

When viewing messages:

- **Navigation**: Use arrow keys or scroll
- **Search**: Press `Ctrl+F` to search within messages
- **Format**: JSON is automatically pretty-printed
- **Copy**: Right-click to copy message content
- **Time Travel**: Filter by timestamp range

## Keyboard Shortcuts

| Shortcut | Command |
|----------|---------|
| `Ctrl+Shift+S` | Connect to Streamline |
| `Ctrl+Shift+R` | Refresh topics |
| `Ctrl+Shift+N` | Create new topic |

## Requirements

- VS Code 1.85.0 or later
- Streamline server (HTTP API must be enabled)

## Troubleshooting

### Cannot connect to server

1. Verify the server is running: `curl http://localhost:9094/health`
2. Check firewall settings
3. Ensure HTTP API is enabled on the server

### Topics not showing

1. Click the refresh button
2. Check connection status in the status bar
3. Verify you have permissions to list topics

## Contributing

Contributions are welcome! Please see the [contributing guide](https://github.com/streamline-dev/streamline/blob/main/CONTRIBUTING.md).

## License

Apache 2.0
<!-- refactor: f3c99816 -->
