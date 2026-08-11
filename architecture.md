# AgentGrid — Architecture

> **Discover and hire autonomous agents on BNB Chain.**

AgentGrid is a Web3-native AI agent marketplace. The frontend, backend, database, blockchain, AI layer, and partner integrations are intentionally separated.

---

## 1. High-Level Architecture

```mermaid
flowchart TB

    U["👤 User / Wallet"]

    subgraph APP["AgentGrid"]
        FE["Frontend /app"]
        API["Backend API"]
        AI["AI Copilot"]
    end

    DB[("Supabase / PostgreSQL")]

    subgraph BNB["BNB Smart Chain"]
        E8004["ERC-8004\nAgent Identity"]
        E8183["ERC-8183\nAgent Hiring"]
        TX["Transactions"]
    end

    ALT["Altana"]
    PCS["PancakeSwap"]
    AG["AI Agents"]

    U --> FE
    FE --> API
    FE --> AI

    API --> DB
    API --> BNB
    API --> ALT
    API --> PCS
    API --> AG

    E8004 --> TX
    E8183 --> TX
    ALT --> TX
    PCS --> TX
    AG --> TX

    TX --> API
```

---

# 2. Core Architecture

```text
                         USER
                          │
                          ▼
                ┌──────────────────┐
                │    FRONTEND      │
                │      /app        │
                └────────┬─────────┘
                         │
                         ▼
                ┌──────────────────┐
                │    BACKEND API   │
                │                  │
                │ Auth             │
                │ Agents           │
                │ Search           │
                │ Hiring           │
                │ Transactions     │
                │ AI               │
                │ Integrations     │
                └───────┬──────────┘
                        │
            ┌───────────┼────────────┐
            │           │            │
            ▼           ▼            ▼
       SUPABASE     BNB CHAIN    PARTNERS
       PostgreSQL      │         ├─ Altana
                      │         ├─ PancakeSwap
                      │         └─ ERC-8183
                      │
                      ▼
                 ON-CHAIN STATE
```

---

# 3. Supabase vs BNB Chain

The most important architectural rule:

> **Supabase stores application data. BNB Chain stores/verifies on-chain state.**

| Data | Source of Truth |
|---|---|
| Wallet ownership | Wallet signature / BNB Chain |
| Agent identity | ERC-8004 / BNB Chain |
| Transactions | BNB Chain |
| Payments | BNB Chain |
| Permissions | Altana / BNB Chain |
| Session revocation | Altana / BNB Chain |
| Agent metadata | Supabase |
| Search index | Supabase |
| Categories | Supabase |
| Marketplace activity | Supabase + indexed chain data |
| User preferences | Supabase |
| Hire history | Supabase + transaction references |
| AI context | Backend + Supabase |

Supabase may **cache/index blockchain data**, but must never override authoritative on-chain state.

---

# 4. Communication Model

```mermaid
flowchart LR

    FE["Frontend"]
    API["Backend API"]
    DB[("Supabase")]
    CHAIN["BNB Chain"]
    ALT["Altana"]
    PCS["PancakeSwap"]
    AI["AI Provider"]

    FE --> API

    API --> DB
    API --> CHAIN
    API --> ALT
    API --> PCS
    API --> AI
```

### Rule

```text
Frontend
   │
   ▼
Backend
   │
   ├── Supabase
   ├── BNB Chain
   ├── Altana
   ├── PancakeSwap
   └── AI Provider
```

The frontend should not contain:

- Private keys
- Service-role keys
- Partner secrets
- Sensitive business logic

---

# 5. Authentication

AgentGrid uses wallet-based authentication.

```mermaid
sequenceDiagram

    participant U as User
    participant F as Frontend
    participant W as Wallet
    participant API as Backend
    participant DB as Supabase

    U->>F: Connect Wallet
    F->>API: Request Nonce
    API-->>F: Nonce + Message
    F->>W: Sign Message
    W-->>F: Signature
    F->>API: Wallet + Signature
    API->>API: Verify Signature
    API->>DB: Create / Update User
    API-->>F: Authenticated Session
```

### Important

The wallet address alone is **not authentication**.

Authentication requires proof of wallet ownership through a signature.

---

# 6. ERC-8004 Agent Discovery

AgentGrid indexes agents registered on-chain.

```mermaid
flowchart LR

    BNB["BNB Chain"]
    R["ERC-8004 Registry"]
    I["AgentGrid Indexer"]
    N["Normalizer"]
    DB[("Supabase")]
    API["Marketplace API"]
    UI["Discover Agents"]

    BNB --> R
    R --> I
    I --> N
    N --> DB
    DB --> API
    API --> UI
```

### Indexed information

```text
Agent ID
Owner
Metadata URI
Registration transaction
Block number
Timestamp
Capabilities
```

On-chain identity remains authoritative.

---

# 7. Agent Listing Flow

```mermaid
flowchart TD

    OWNER["Agent Owner"]
    WALLET["Connect Wallet"]
    VERIFY["Verify Agent"]
    META["Agent Metadata"]
    VALIDATE["Backend Validation"]
    DB[("Supabase")]
    MARKET["Marketplace"]

    OWNER --> WALLET
    WALLET --> VERIFY
    VERIFY --> META
    META --> VALIDATE
    VALIDATE --> DB
    DB --> MARKET
```

### Listing principle

```text
On-chain identity
        +
Marketplace metadata
        ↓
Public Agent Listing
```

Marketplace metadata must not be presented as blockchain-verified information.

---

# 8. Agent Discovery

```text
                    DISCOVER AGENTS
                           │
              ┌────────────┴────────────┐
              │                         │
           Search                    Filters
              │                         │
              │             ┌───────────┼───────────┐
              │             │           │           │
              │         Category     Protocol    Status
              │             │           │           │
              │         Trading     PancakeSwap  Trending
              │         Yield       Venus         New
              │         Research    Aave          Verified
              │         Security    Lista         Popular
              │
              └────────────┬────────────┘
                           ▼
                     Search Service
                           │
                           ▼
                       Supabase
                           │
                           ▼
                    Ranked Results
```

---

# 9. Marketplace Categories

Categories are discovery filters, not necessarily sidebar navigation items.

```text
Monitoring
Trading
Yield
Research
Security
DeFi
Portfolio
Automation
```

Protocol filters can include:

```text
PancakeSwap
Venus
Aave
Lista
Other BNB protocols
```

Marketplace filters can include:

```text
Trending
Newly Listed
Most Hired
Highest Rated
Highest Success Rate
Price
Verified
```

---

# 10. Marketplace Overview

The Overview page surfaces ecosystem activity.

```text
                 MARKETPLACE OVERVIEW
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
    Agent Stats       Recent Activity     Trends
        │                 │                 │
        ▼                 ▼                 ▼
   Active Agents      New Listings       Categories
   New Agents        Recent Hires       Protocols
   Total Hires       Transactions       Agents
```

Supported time windows:

```text
15m
30m
1h
24h
7d
```

---

# 11. Trending

Trending should be calculated from recent activity.

```text
Trending Score
      │
      ├── Recent Hires
      ├── Successful Tasks
      ├── Views
      ├── Recent Activity
      └── Transaction Activity
```

The scoring formula should be implemented in the backend and kept configurable.

---

# 12. Agent Hiring Flow

```mermaid
sequenceDiagram

    participant U as User
    participant F as Frontend
    participant API as Backend
    participant W as Wallet
    participant BNB as BNB Chain
    participant A as Agent
    participant DB as Supabase

    U->>F: Open Agent
    U->>F: Hire Agent
    F->>API: Prepare Hire
    API->>DB: Validate Agent
    API-->>F: Hire Details

    F->>W: Request Signature
    W->>BNB: Submit Transaction

    BNB-->>API: Transaction Hash
    API->>DB: Record Pending Hire

    BNB->>A: Execute Task
    A-->>BNB: Execution Result

    API->>BNB: Verify Transaction
    BNB-->>API: Confirmed

    API->>DB: Update Hire
    API-->>F: Result
```

---

# 13. Transaction State

```text
CREATED
   │
   ▼
AWAITING_SIGNATURE
   │
   ▼
SUBMITTED
   │
   ▼
PENDING
   │
   ▼
CONFIRMED
```

Failure states:

```text
REJECTED
FAILED
EXPIRED
CANCELLED
```

A transaction hash does **not** mean the transaction succeeded.

---

# 14. Altana Architecture

Altana provides scoped autonomy for agents.

```mermaid
flowchart TD

    USER["User"]
    AGENT["AI Agent"]
    SESSION["Scoped Session"]
    KEY["Session Key"]
    REG["Altana Keystore / Registry"]
    BNB["BNB Chain"]
    PROTOCOL["Approved Protocol"]

    USER -->|"Grant"| SESSION
    SESSION --> KEY
    SESSION --> REG
    REG --> BNB

    AGENT --> SESSION
    SESSION --> PROTOCOL
```

---

# 15. Altana Permissions

A session can define:

```text
Agent
   │
   ├── Allowed contracts
   ├── Allowed functions
   ├── Spend cap
   ├── Expiry
   └── Session key
```

Example:

```text
Agent: Yield Agent

Contract:
PancakeSwap

Allowed:
swap()

Spend Cap:
$100

Expiry:
24 hours
```

The user must see these permissions before granting them.

---

# 16. Altana Session Flow

```mermaid
sequenceDiagram

    participant U as User
    participant F as Frontend
    participant API as AgentGrid
    participant ALT as Altana
    participant W as Wallet
    participant BNB as BNB Chain

    U->>F: Configure Permissions
    F->>API: Validate Request
    API->>ALT: Prepare Session
    ALT-->>F: Transaction Data
    F->>W: Request Signature
    W->>BNB: Register Session
    BNB-->>ALT: Session Registered
    BNB-->>API: Confirmation
    API->>API: Index Session
```

---

# 17. Revocation

```text
USER
  │
  ▼
Agent Permissions
  │
  ▼
REVOKE
  │
  ▼
Wallet Signature
  │
  ▼
Altana
  │
  ▼
BNB Chain
  │
  ▼
Session Revoked
```

Supabase must never be used to fake a revocation.

---

# 18. PancakeSwap

PancakeSwap is a **protocol filter/integration**, not necessarily a primary sidebar section.

```text
Discover Agents
      │
      ▼
Filters
      │
      ├── Categories
      │
      ├── Protocols
      │      └── PancakeSwap
      │
      └── Marketplace
             Filters
```

Potential PancakeSwap agent use cases:

```text
Liquidity Management
Yield Discovery
Market Research
Safe Automated Swaps
```

---

# 19. PancakeSwap + Altana

```mermaid
sequenceDiagram

    participant U as User
    participant G as AgentGrid
    participant A as Agent
    participant ALT as Altana
    participant P as PancakeSwap
    participant B as BNB Chain

    U->>G: Hire Agent
    G->>U: Show Required Permissions
    U->>ALT: Grant Scoped Session
    ALT->>B: Register Session

    A->>ALT: Request Action
    ALT->>A: Allow if Within Scope
    A->>P: Execute Swap / DeFi Action
    P->>B: On-chain Transaction

    B-->>G: Transaction Event
    G-->>U: Result
```

---

# 20. AI Copilot

The AI Copilot can be opened globally as a right-side panel.

```text
┌──────────────────────────────────────────────────────────────┐
│ AgentGrid                  Search...       Wallet             │
├───────────────────────────────┬──────────────────────────────┤
│                               │                              │
│       Marketplace             │         ASK AI               │
│                               │                              │
│       Agent content           │  "What agent should I use    │
│                               │   for yield optimization?"    │
│                               │                              │
│                               │  AI Response                 │
│                               │                              │
└───────────────────────────────┴──────────────────────────────┘
```

---

# 21. AI Context

```mermaid
flowchart TD

    USER["User"]
    AI["AI Copilot"]

    AGENTS["Agent Catalog"]
    PERF["Performance"]
    PROTOCOLS["Protocols"]
    ACTIVITY["Activity"]
    CONTEXT["Current Agent / Page"]

    AGENTS --> AI
    PERF --> AI
    PROTOCOLS --> AI
    ACTIVITY --> AI
    CONTEXT --> AI

    USER --> AI
```

On an agent page:

```text
Ask questions about + [Agent Name]
```

The AI receives the current agent's structured data and capabilities.

---

# 22. AI Safety Boundary

```text
AI CAN
 ├── Search
 ├── Compare
 ├── Explain
 ├── Recommend
 ├── Analyze
 └── Prepare a transaction

AI CANNOT
 ├── Silently sign
 ├── Move funds
 ├── Grant permissions
 ├── Revoke permissions
 └── Execute financial actions
```

User approval is required for wallet actions.

---

# 23. Backend Services

```text
backend/
│
├── auth
├── agents
├── search
├── marketplace
├── hiring
├── transactions
├── activity
├── performance
├── reputation
├── ai
├── permissions
└── integrations
       ├── erc8004
       ├── erc8183
       ├── altana
       ├── pancakeswap
       └── x402
```

---

# 24. Backend Communication

```mermaid
flowchart TB

    API["API Layer"]

    API --> AUTH["Auth Service"]
    API --> AGENTS["Agent Service"]
    API --> SEARCH["Search Service"]
    API --> HIRE["Hiring Service"]
    API --> TX["Transaction Service"]
    API --> AI["AI Service"]
    API --> PERM["Permission Service"]

    AGENTS --> DB[("Supabase")]
    SEARCH --> DB
    HIRE --> DB
    TX --> DB
    AI --> DB

    HIRE --> E8183["ERC-8183"]
    AGENTS --> E8004["ERC-8004"]
    PERM --> ALT["Altana"]
    TX --> BNB["BNB Chain"]
    TX --> PCS["PancakeSwap"]
```

---

# 25. Adapter Pattern

External integrations should be isolated behind adapters.

```text
                SERVICE
                   │
                   ▼
              ADAPTER
                   │
        ┌──────────┼──────────┐
        ▼          ▼          ▼
      Altana   PancakeSwap  ERC-8183
```

This prevents partner-specific code from spreading throughout the application.

---

# 26. Database Overview

```mermaid
erDiagram

    USERS ||--o{ HIRES : creates
    USERS ||--o{ AGENTS : owns
    AGENTS ||--o{ CAPABILITIES : has
    AGENTS ||--o{ PERFORMANCE : has
    AGENTS ||--o{ HIRES : receives
    AGENTS ||--o{ PROTOCOLS : supports
    HIRES ||--o{ TRANSACTIONS : contains
    USERS ||--o{ SESSIONS : grants
    AGENTS ||--o{ SESSIONS : uses

    USERS {
        uuid id
        string wallet_address
        string display_name
    }

    AGENTS {
        uuid id
        string onchain_agent_id
        string name
        string slug
        string owner_wallet
        string category
        string verification_status
    }

    HIRES {
        uuid id
        uuid agent_id
        string user_wallet
        string status
        string transaction_hash
    }

    PERFORMANCE {
        uuid id
        uuid agent_id
        float success_rate
        integer tasks_completed
        string evaluation_window
    }

    SESSIONS {
        uuid id
        uuid agent_id
        string session_id
        string status
        timestamp expiry
    }

    TRANSACTIONS {
        uuid id
        string transaction_hash
        string status
        integer chain_id
    }
```

---

# 27. Blockchain Indexing

```mermaid
flowchart LR

    BNB["BNB Chain"]
       │
       ▼
    EVENTS["Events"]
       │
       ▼
    INDEXER["Indexer"]
       │
       ▼
    PARSER["Parser"]
       │
       ▼
    NORMALIZER["Normalizer"]
       │
       ▼
    DB[("Supabase")]
       │
       ▼
    MARKET["Marketplace"]
```

Indexing must be:

```text
Idempotent
Restart-safe
Deduplicated
Chain-aware
```

---

# 28. Agent Performance

```text
Agent
  │
  ├── Tasks Completed
  ├── Success Rate
  ├── Execution Time
  ├── Cost
  ├── User Ratings
  └── On-chain Activity
          │
          ▼
      Reputation
```

Performance claims should always have an evaluation window.

Example:

```text
Success Rate
94.2%

Tasks
1,243

Evaluation
Last 90 days
```

---

# 29. TermiX — Agent Advantage

No direct TermiX integration is required.

AgentGrid provides the evidence.

```text
              AGENT ADVANTAGE
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
        Time       Cost      Quality
          │          │          │
          └──────────┼──────────┘
                     ▼
              Manual vs Agent
```

Benchmark dataset:

```text
Task
Agent
Manual Time
Agent Time
Manual Cost
Agent Cost
Manual Output
Agent Output
Quality
Evaluation Notes
```

At least three real benchmark tasks should be recorded.

---

# 30. Agent-to-Agent Commerce

```mermaid
flowchart LR

    A["Agent A"]
    M["AgentGrid"]
    H["Hiring / Payment"]
    B["Agent B"]
    R["Result"]

    A --> M
    M --> H
    H --> B
    B --> R
    R --> A
```

Potential infrastructure:

```text
ERC-8183
x402 / B402
Altana
BNB Chain
```

---

# 31. Security Boundary

```text
┌─────────────────────────────────────┐
│             FRONTEND                │
│                                     │
│ UI / Wallet / User Interaction      │
└──────────────────┬──────────────────┘
                   │
                   ▼
┌─────────────────────────────────────┐
│              BACKEND                │
│                                     │
│ Validation / Authorization / Logic  │
└───────────────┬───────────┬─────────┘
                │           │
                ▼           ▼
          ┌──────────┐  ┌────────────┐
          │ Supabase │  │ BNB Chain  │
          └──────────┘  └────────────┘
```

Never expose:

```text
Private Keys
Service Role Keys
Partner Secrets
AI Provider Secrets
RPC Credentials
```

---

# 32. Data Ownership Rule

```text
┌───────────────────────┬──────────────────────────┐
│       SUPABASE        │       BNB / ALTANA       │
├───────────────────────┼──────────────────────────┤
│ Search                │ Wallet ownership         │
│ Profiles              │ Agent identity           │
│ Categories            │ Transactions             │
│ Marketplace metadata  │ Payments                 │
│ User preferences      │ Permissions              │
│ Activity index        │ Session revocation       │
│ Performance index     │ Smart contract state     │
└───────────────────────┴──────────────────────────┘
```

---

# 33. Repository Structure

```text
/
├── app/                    # Frontend
│
├── backend/                # Backend/API
│   ├── auth/
│   ├── agents/
│   ├── search/
│   ├── hiring/
│   ├── transactions/
│   ├── ai/
│   └── integrations/
│
├── lib/                    # Shared infrastructure
│   ├── blockchain/
│   ├── supabase/
│   ├── erc8004/
│   ├── erc8183/
│   ├── altana/
│   ├── pancakeswap/
│   └── payments/
│
├── database/
│   ├── migrations/
│   └── seeds/
│
├── scripts/
│   └── indexing/
│
├── tests/
│
├── README.md
├── architecture.md
└── .env.example
```

The exact folder structure may evolve with the chosen framework, but the architectural boundaries should remain intact.

---

# 34. Hackathon Architecture

The initial implementation should remain simple.

```text
                 HACKATHON MVP

              ┌──────────────┐
              │   Frontend   │
              └──────┬───────┘
                     │
              ┌──────▼───────┐
              │ Backend API  │
              └──┬───────┬───┘
                 │       │
          ┌──────▼───┐ ┌─▼──────────┐
          │ Supabase │ │ BNB Chain  │
          └──────────┘ └─────┬──────┘
                              │
                    ┌─────────┼─────────┐
                    ▼         ▼         ▼
                  Altana   PancakeSwap ERC-8004
```

Avoid unnecessary microservices.

---

# 35. Long-Term Evolution

```text
PHASE 1
Monolithic Backend
+
Supabase
+
BNB Chain
+
Partner Adapters

              ↓

PHASE 2
Dedicated Indexer
+
Background Workers
+
Caching
+
Search Optimization

              ↓

PHASE 3
Execution Workers
+
Dedicated Search
+
Scalable Agent Infrastructure
```

---

# 36. Architecture Rules

### Rule 01

**Blockchain is authoritative for on-chain state.**

### Rule 02

**Supabase is the application database, not a blockchain replacement.**

### Rule 03

**Users control their wallets.**

### Rule 04

**AI cannot silently perform financial actions.**

### Rule 05

**Agents receive minimum necessary permissions.**

### Rule 06

**Partner integrations use adapters.**

### Rule 07

**Every blockchain transaction must be verified.**

### Rule 08

**Marketplace claims should be backed by data.**

### Rule 09

**The frontend communicates with the backend through defined APIs.**

### Rule 10

**Keep the hackathon architecture simple enough for a two-person team.**

---

# 37. The Mental Model

If either developer forgets how something works, use this:

```text
                    AGENTGRID
                       │
       ┌───────────────┼────────────────┐
       │               │                │
       ▼               ▼                ▼
   DISCOVERY        COMMERCE        AUTONOMY
       │               │                │
       ▼               ▼                ▼
 Supabase          BNB Chain         Altana
       │               │                │
       └───────────────┼────────────────┘
                       ▼
                  AI AGENTS
                       │
                       ▼
                 BNB ECOSYSTEM
```

Or, even simpler:

```text
SUPABASE
"What does the marketplace know?"

        +

BNB CHAIN
"What actually happened?"

        +

ALTANA
"What is this agent allowed to do?"

        +

AI
"How does the user interact with all of this?"

        +

AGENTS
"What actually performs the work?"
```

> **AgentGrid = Discovery + Trust + Hiring + Autonomous Execution.**