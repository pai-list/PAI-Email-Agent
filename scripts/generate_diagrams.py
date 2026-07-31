#!/usr/bin/env python3
"""
Generate architecture diagrams for PAI-Email-Agent
Outputs: SVG, PNG, and Mermaid source files
"""

import subprocess
import os
from pathlib import Path

DIAGRAMS_DIR = Path(__file__).parent / 'diagrams'
DIAGRAMS_DIR.mkdir(exist_ok=True)

# ──────────────────────────────────────────────────────────────
# Mermaid Source Files
# ──────────────────────────────────────────────────────────────

MERMAID_FILES = {
    'system-overview.mmd': '''
graph TB
    subgraph "External Systems"
        Sender[External Email Sender]
        Recipient[External Email Recipient]
        ResendAPI[Resend API]
        AgentWebhook[Agent Webhook Endpoint]
    end

    subgraph "Cloudflare Edge Network"
        EmailRouting[Cloudflare Email Routing]
        
        subgraph "Workers Runtime"
            EmailRouter[Email Router Worker]
            EmailSender[Email Sender Worker]
            WebhookProcessor[Webhook Processor Worker]
        end
        
        subgraph "Storage Layer"
            EmailKV[(EMAIL_KV)]
            AgentKV[(AGENT_KV)]
            RateLimitKV[(RATE_LIMIT_KV)]
            WebhookKV[(WEBHOOK_KV)]
            AgentInboxDO[(AGENT_INBOX_DO)]
        end
    end

    subgraph "PAI Universe"
        AxiomID[AxiomID / Agent Passport]
        PiNetwork[Pi Network]
        Freenet[Freenet/Hyphanet]
    end

    %% Inbound Flow
    Sender --> EmailRouting
    EmailRouting -->|Catch-all *@agents.axiomid.app| EmailRouter
    EmailRouter -->|Store| AgentInboxDO
    EmailRouter -->|Index| EmailKV
    AgentInboxDO -->|Async deliver| WebhookProcessor
    WebhookProcessor -->|HTTP POST| AgentWebhook
    
    %% Outbound Flow
    AxiomID -->|Issue JWT| AgentWebhook
    AgentWebhook -->|POST /send + JWT| EmailSender
    EmailSender -->|Validate JWT| AxiomID
    EmailSender -->|Check Rate Limit| RateLimitKV
    EmailSender -->|Check Quota| AgentKV
    EmailSender -->|Send via API| ResendAPI
    ResendAPI -->|Deliver| Recipient
    ResendAPI -->|Webhook| EmailSender
    EmailSender -->|Track Status| EmailKV
    EmailSender -->|Notify Agent| WebhookProcessor
    WebhookProcessor -->|HTTP POST| AgentWebhook
    
    %% Cross-system
    EmailSender -.->|Future: Pi Network payments| PiNetwork
    AgentInboxDO -.->|Future: Immutable storage| Freenet
''',
    
    'inbound-flow.mmd': '''
sequenceDiagram
    participant Sender as External Sender
    participant CFEmail as Cloudflare Email Routing
    participant Router as Email Router Worker
    participant DO as AgentInboxDO
    participant KV as EMAIL_KV / AGENT_KV
    participant WP as Webhook Processor
    participant Agent as PAI Agent

    Sender->>CFEmail: SMTP: To alice@agents.axiomid.app
    CFEmail->>Router: HTTP POST /email (multipart/form-data)
    Router->>Router: Extract agentName from recipient
    Router->>DO: storeEmail(agentName, email)
    DO->>KV: Put email + Update index
    DO-->>Router: StoredEmail (with ID)
    Router-->>CFEmail: 202 Accepted
    
    par Async Webhook Delivery
        Router->>WP: Queue webhook delivery
        WP->>AgentKV: Get webhook config
        WP->>Agent: POST /webhook/email (with HMAC)
        Agent-->>WP: 200 OK
    end
''',

    'outbound-flow.mmd': '''
sequenceDiagram
    participant Agent as PAI Agent
    participant AxiomID as AxiomID/Passport
    participant Sender as Email Sender Worker
    participant KV as RATE_LIMIT_KV / AGENT_KV
    participant Resend as Resend API
    participant Recipient as External Recipient
    participant WP as Webhook Processor

    Agent->>AxiomID: Request Agent Passport JWT
    AxiomID-->>Agent: JWT (claims: permissions, quota)
    
    Agent->>Sender: POST /send + Bearer JWT
    Sender->>Sender: Verify JWT (HS256)
    Sender->>Sender: Check permissions (email:send)
    Sender->>KV: Check rate limit (hourly/daily/monthly)
    KV-->>Sender: Allow/Deny
    Sender->>Resend: POST /emails (with tags/metadata)
    Resend-->>Sender: { id: "re_...", status: "queued" }
    Sender->>KV: Record rate limit usage
    Sender->>KV: Link messageId → agentName
    Sender-->>Agent: { messageId, status, rateLimit }
    
    par Async Status Tracking
        Resend->>Sender: Webhook (delivered/bounced/opened)
        Sender->>KV: Update email status
        Sender->>WP: Queue status webhook
        WP->>Agent: POST /webhook/email/status
    end
''',

    'auth-flow.mmd': '''
sequenceDiagram
    participant Agent
    participant AxiomID
    participant EmailSender
    
    Agent->>AxiomID: Authenticate (Pi wallet / credentials)
    AxiomID->>AxiomID: Verify identity
    AxiomID->>Agent: Issue Agent Passport JWT
    Note over Agent,EmailSender: JWT Claims:<br/>- agentName<br/>- agentDomain<br/>- permissions[]<br/>- emailQuota<br/>- exp (1hr)
    
    Agent->>EmailSender: POST /send + Bearer JWT
    EmailSender->>EmailSender: Verify JWT signature (HS256)
    EmailSender->>EmailSender: Validate claims (iss, aud, exp)
    EmailSender->>EmailSender: Check permissions
    EmailSender-->>Agent: 200 OK / 401 / 403
''',

    'network-topology.mmd': '''
graph TB
    subgraph "Cloudflare Global Network"
        subgraph "Edge POPs"
            POP1[Edge POP 1<br/>(Email Router)]
            POP2[Edge POP 2<br/>(Email Sender)]
            POP3[Edge POP 3<br/>(Webhook Processor)]
        end
        
        subgraph "Global KV (Eventually Consistent)"
            KV1[(EMAIL_KV)]
            KV2[(AGENT_KV)]
            KV3[(RATE_LIMIT_KV)]
            KV4[(WEBHOOK_KV)]
        end
        
        subgraph "Durable Objects (Per Agent)"
            DO1[Agent: alice]
            DO2[Agent: bob]
            DO3[Agent: charlie]
        end
    end
    
    POP1 --> KV1
    POP1 --> KV2
    POP1 --> DO1
    POP1 --> DO2
    POP1 --> DO3
    
    POP2 --> KV1
    POP2 --> KV2
    POP2 --> KV3
    POP2 --> KV4
    
    POP3 --> KV4
    POP3 --> KV2
''',

    'data-model.mmd': '''
erDiagram
    AGENT_REGISTRATION ||--o{ STORED_EMAIL : receives
    AGENT_REGISTRATION ||--o{ RATE_LIMIT : has
    AGENT_REGISTRATION ||--o{ WEBHOOK_QUEUE : sends
    STORED_EMAIL ||--o{ ATTACHMENT : contains
    STORED_EMAIL ||--o{ EMAIL_STATUS : tracks
    EMAIL_STATUS ||--o{ WEBHOOK_DELIVERY : triggers
    AGENT_REGISTRATION {
        string agentName PK
        string agentDomain
        string emailAddress
        string webhookUrl
        string statusEndpoint
        json permissions
        json emailQuota
        json webhookConfig
        timestamp createdAt
        timestamp updatedAt
        string status
    }
    STORED_EMAIL {
        string id PK
        string agentName FK
        json from
        json to[]
        json cc[]
        string subject
        string text
        string html
        json headers
        json attachments[]
        timestamp receivedAt
        int size
        int spamScore
        string dkimResult
        string spfResult
        string dmarcResult
        boolean processed
        timestamp webhookDeliveredAt
        int webhookAttempts
    }
    RATE_LIMIT {
        string key PK
        int count
        timestamp windowStart
        timestamp expiresAt
    }
    WEBHOOK_QUEUE {
        string id PK
        string agentName FK
        string event
        json payload
        int attempts
        int maxAttempts
        timestamp createdAt
        timestamp nextRetryAt
        string lastError
    }
    EMAIL_STATUS {
        string messageId PK
        string agentName FK
        string status
        timestamp timestamp
        json metadata
        timestamp updatedAt
        json history[]
    }
    WEBHOOK_DELIVERY {
        string id PK
        string messageId FK
        string agentName FK
        string event
        int attempt
        boolean success
        int statusCode
        string error
        timestamp timestamp
    }
'''
}

# ──────────────────────────────────────────────────────────────
# Generate Functions
# ──────────────────────────────────────────────────────────────

def write_mermaid_files():
    """Write all Mermaid source files"""
    for filename, content in MERMAID_FILES.items():
        filepath = DIAGRAMS_DIR / filename
        filepath.write_text(content.strip())
        print(f"✓ Written: {filepath}")

def check_mermaid_cli():
    """Check if mermaid-cli is available"""
    try:
        result = subprocess.run(['mmdc', '--version'], capture_output=True, text=True)
        return result.returncode == 0
    except FileNotFoundError:
        return False

def generate_svgs():
    """Generate SVG files from Mermaid using mermaid-cli"""
    if not check_mermaid_cli():
        print("⚠ mermaid-cli (mmdc) not found. Install with: npm i -g @mermaid-js/mermaid-cli")
        return False
    
    for filename in MERMAID_FILES.keys():
        input_path = DIAGRAMS_DIR / filename
        output_path = DIAGRAMS_DIR / filename.replace('.mmd', '.svg')
        
        try:
            subprocess.run([
                'mmdc',
                '-i', str(input_path),
                '-o', str(output_path),
                '-b', 'transparent',
                '-w', '1200'
            ], check=True, capture_output=True)
            print(f"✓ Generated SVG: {output_path.name}")
        except subprocess.CalledProcessError as e:
            print(f"✗ Failed to generate {output_path.name}: {e.stderr.decode()}")
    
    return True

def generate_pngs():
    """Generate PNG files from Mermaid using mermaid-cli"""
    if not check_mermaid_cli():
        return False
    
    for filename in MERMAID_FILES.keys():
        input_path = DIAGRAMS_DIR / filename
        output_path = DIAGRAMS_DIR / filename.replace('.mmd', '.png')
        
        try:
            subprocess.run([
                'mmdc',
                '-i', str(input_path),
                '-o', str(output_path),
                '-b', 'white',
                '-w', '1200',
                '--scale', '2'
            ], check=True, capture_output=True)
            print(f"✓ Generated PNG: {output_path.name}")
        except subprocess.CalledProcessError as e:
            print(f"✗ Failed to generate {output_path.name}: {e.stderr.decode()}")
    
    return True

def main():
    print("🎨 Generating PAI-Email-Agent Architecture Diagrams\n")
    
    # Write Mermaid source files
    write_mermaid_files()
    print()
    
    # Generate SVGs
    print("Generating SVG diagrams...")
    generate_svgs()
    print()
    
    # Generate PNGs
    print("Generating PNG diagrams...")
    generate_pngs()
    print()
    
    print("✅ Diagram generation complete!")
    print(f"📁 Output directory: {DIAGRAMS_DIR}")

if __name__ == '__main__':
    main()