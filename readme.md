Here's a clean, professional `README.md` tailored to your Ludo realtime backend server.

## `README.md`

```markdown
# Ludo Realtime Backend

A lightweight Node.js + TypeScript + Socket.IO server that powers the real-time multiplayer backend for a Ludo game. Handles room creation, player matchmaking, turn management, dice rolls, token moves, and game state synchronization across connected clients.

---

## ✨ Features

- **Real-time multiplayer** via Socket.IO
- **Room-based matchmaking** — players join a room with a shareable ID
- **Authoritative game engine** — all game rules validated on the server
- **Turn-based state machine** — handles dice rolls, token moves, extra turns, and win conditions
- **Live state sync** — every client receives `game:state` updates instantly
- **Session persistence** — reconnect support using a stored player session
- **Type-safe** — written in TypeScript with strict types shared across events

---

## 🛠 Tech Stack

| Layer            | Tech                          |
| ---------------- | ----------------------------- |
| Runtime          | Node.js                       |
| Language         | TypeScript                    |
| Realtime         | Socket.IO                     |
| Dev runner       | tsx (watch mode)              |
| Build            | tsc                           |

---

## 📁 Project Structure

```
server/
├─ src/
│  ├─ gameEngine.ts      # Core Ludo rules: dice, moves, captures, win detection
│  ├─ turnMachine.ts     # Turn ordering, extra-turn logic, skipped turns
│  ├─ types.ts           # Shared types (GameState, Player, PlayerColor, events)
│  └─ index.ts           # Socket.IO server + event handlers
├─ package.json
├─ tsconfig.json
└─ .gitignore
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **npm** (or pnpm / yarn)

### Installation

```bash
git clone https://github.com/M-SuhaibGM/Ludo-Real-time-Backend.git
cd Ludo-Real-time-Backend
npm install
```

### Development

```bash
npm run dev
```

Runs `src/index.ts` with `tsx watch` — auto-restarts on file changes.

### Build & Production

```bash
npm run build     # compiles to dist/
npm start         # runs dist/index.js
```

The server listens on **port 3001** by default (adjust in `src/index.ts` or via env).

---

## 📜 NPM Scripts

| Script    | Description                         |
| --------- | ----------------------------------- |
| `dev`     | Run dev server with hot reload      |
| `build`   | Compile TypeScript to `dist/`       |
| `start`   | Run the compiled server             |
| `test`    | Placeholder (no tests yet)          |

---

## 🔌 Socket.IO Events

### Client → Server

| Event        | Payload                  | Description                          |
| ------------ | ------------------------ | ------------------------------------ |
| `room:join`  | `{ roomId, name }`       | Join or create a room                |
| `room:sync`  | `{ roomId }`             | Request full state (on reconnect)    |
| `game:start` | `{ roomId }`             | Host starts the game                 |
| `game:roll`  | `{ roomId }`             | Roll the dice on your turn           |
| `game:move`  | `{ roomId, tokenId }`    | Move a token after rolling           |

### Server → Client

| Event             | Payload                                   | Description                         |
| ----------------- | ----------------------------------------- | ----------------------------------- |
| `game:state`      | `GameState`                               | Full game state after any change    |
| `game:diceRolled` | `{ value, rollId, color }`                | Notifies clients of a dice roll     |

---

## 🧠 Game Engine Overview

- **4 players** — Red, Green, Yellow, Blue
- **4 tokens per player**
- **52-cell shared track** + **5-cell home column** per player
- Server enforces:
  - Roll must be `6` to leave the yard
  - Rolling `6` grants an extra turn
  - Landing on an opponent's token sends it back to the yard (unless on a safe cell)
  - Reaching `steps === 56` marks a token as finished
  - First player to finish all 4 tokens wins

All state transitions happen in `gameEngine.ts` and `turnMachine.ts`, keeping clients as thin renderers.

---

## 🌐 Environment Variables

Create a `.env` file in the root:

```env
PORT=3001
CLIENT_ORIGIN=http://localhost:3000
```

| Variable        | Default                  | Description                         |
| --------------- | ------------------------ | ----------------------------------- |
| `PORT`          | `3001`                   | Port the Socket.IO server listens on |
| `CLIENT_ORIGIN` | `http://localhost:3000`  | Allowed CORS origin for the client  |

---

## 🧪 Testing

Tests are not yet implemented. To add them:

```bash
npm install --save-dev vitest
```

Then write unit tests for `gameEngine.ts` — the pure logic is easy to test in isolation.

---

## 🤝 Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/your-feature`)
3. Commit your changes (`git commit -m "feat: add X"`)
4. Push and open a Pull Request

---

## 📄 License

ISC
```

---

### Notes

- I kept the **structure and event names** aligned with what we've been building in the frontend (`room:join`, `game:roll`, `game:move`, `game:state`, `game:diceRolled`). If your actual event names differ, do a quick find-and-replace.
- The **`CLIENT_ORIGIN`** var assumes your Next.js app runs on `localhost:3000` — change it if you deploy elsewhere.
- I added a **port 3001** default because that's the common convention when the Next.js frontend uses 3000. Adjust if you're using a different port.
- Everything else (scripts, deps, folder layout) matches your `package.json` exactly.

