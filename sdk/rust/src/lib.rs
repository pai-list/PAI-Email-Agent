use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum EmailError {
    #[error("Invalid email format: {0}")]
    InvalidEmail(String),
    #[error("Invalid agent ID format: {0}")]
    InvalidAgentId(String),
    #[error("Body too large: {0} bytes (max 65536)")]
    BodyTooLarge(usize),
    #[error("Too many attachments: {0} (max 10)")]
    TooManyAttachments(usize),
    #[error("Missing required field: {0}")]
    MissingField(String),
    #[error("Agent ID mismatch: email local part '{email_local}' != agentId '{agent_id}'")]
    AgentIdMismatch { email_local: String, agent_id: String },
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Crypto error: {0}")]
    Crypto(String),
}

/// Agent email structure matching the JSON schema
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentEmail {
    pub to: String,
    pub from: String,
    pub subject: String,
    pub body: String,
    pub agent_id: String,
    pub timestamp: String,
    #[serde(default)]
    pub headers: EmailHeaders,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EmailHeaders {
    #[serde(rename = "message-id")]
    pub message_id: Option<String>,
    pub references: Option<String>,
    #[serde(rename = "in-reply-to")]
    pub in_reply_to: Option<String>,
    #[serde(rename = "content-type")]
    pub content_type: Option<String>,
    #[serde(flatten)]
    pub extra: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attachment {
    pub filename: String,
    #[serde(rename = "contentType")]
    pub content_type: String,
    pub size: usize,
    #[serde(rename = "contentId")]
    pub content_id: Option<String>,
}

/// Configuration for the email agent
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailAgentConfig {
    pub resend_api_key: String,
    pub from_domain: String,
    pub default_from_name: String,
    pub passport_private_key: Option<String>,
    pub passport_key_id: Option<String>,
    pub passport_issuer: String,
}

impl Default for EmailAgentConfig {
    fn default() -> Self {
        Self {
            resend_api_key: String::new(),
            from_domain: "axiomid.app".to_string(),
            default_from_name: "PAI Agent".to_string(),
            passport_private_key: None,
            passport_key_id: None,
            passport_issuer: "https://passport.pai.agent".to_string(),
        }
    }
}

/// Email template types
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TemplateName {
    Welcome,
    Notification,
    Verification,
}

/// Email send request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendEmailRequest {
    pub to: String,
    pub subject: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub html: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub react: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub template: Option<TemplateName>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub template_data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub passport: Option<PassportClaims>,
}

/// Passport claims for authorization
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PassportClaims {
    pub iss: String,
    pub sub: String,
    pub aud: Vec<String>,
    pub iat: i64,
    pub exp: i64,
    pub nonce: String,
    pub email: EmailClaims,
    pub agent: AgentClaims,
    pub capabilities: CapabilitiesClaims,
    pub permissions: PermissionsClaims,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evolution: Option<EvolutionClaims>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailClaims {
    pub address: String,
    pub verified: bool,
    pub domain: String,
    #[serde(rename = "localPart")]
    pub local_part: String,
    pub routing: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentClaims {
    pub id: String,
    pub name: String,
    pub subdomain: String,
    pub owner: String,
    pub status: String,
    pub mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilitiesClaims {
    #[serde(rename = "sendEmail")]
    pub send_email: SendEmailCapabilities,
    #[serde(rename = "receiveEmail")]
    pub receive_email: ReceiveEmailCapabilities,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendEmailCapabilities {
    pub enabled: bool,
    pub provider: String,
    #[serde(rename = "dailyLimit")]
    pub daily_limit: u32,
    #[serde(rename = "monthlyLimit")]
    pub monthly_limit: u32,
    pub templates: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReceiveEmailCapabilities {
    pub enabled: bool,
    pub routing: String,
    #[serde(rename = "maxSizeKB")]
    pub max_size_kb: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionsClaims {
    pub scopes: Vec<String>,
    #[serde(rename = "delegatedFrom")]
    pub delegated_from: Vec<String>,
    #[serde(rename = "delegatedTo")]
    pub delegated_to: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvolutionClaims {
    pub version: u32,
    #[serde(rename = "parentPassport")]
    pub parent_passport: Option<String>,
    pub mutations: Vec<Value>,
    #[serde(rename = "fitnessScore")]
    pub fitness_score: Option<f32>,
}

/// Email send response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendEmailResponse {
    pub id: String,
}

impl AgentEmail {
    /// Validate the email structure
    pub fn validate(&self) -> Result<(), EmailError> {
        // Check required fields
        if self.to.is_empty() {
            return Err(EmailError::MissingField("to".to_string()));
        }
        if self.from.is_empty() {
            return Err(EmailError::MissingField("from".to_string()));
        }
        if self.subject.is_empty() {
            return Err(EmailError::MissingField("subject".to_string()));
        }
        if self.body.is_empty() {
            return Err(EmailError::MissingField("body".to_string()));
        }
        if self.agent_id.is_empty() {
            return Err(EmailError::MissingField("agent_id".to_string()));
        }
        if self.timestamp.is_empty() {
            return Err(EmailError::MissingField("timestamp".to_string()));
        }

        // Validate email format
        let email_regex = regex::Regex::new(r"^[^\s@]+@[^\s@]+\.[^\s@]+$").unwrap();
        if !email_regex.is_match(&self.to) {
            return Err(EmailError::InvalidEmail(self.to.clone()));
        }
        if !email_regex.is_match(&self.from) {
            return Err(EmailError::InvalidEmail(self.from.clone()));
        }

        // Validate agent ID format
        let agent_id_regex = regex::Regex::new(r"^[a-z0-9][a-z0-9-]{2,29}$").unwrap();
        if !agent_id_regex.is_match(&self.agent_id) {
            return Err(EmailError::InvalidAgentId(self.agent_id.clone()));
        }

        // Check body size
        if self.body.len() > 65536 {
            return Err(EmailError::BodyTooLarge(self.body.len()));
        }

        // Check attachments limit
        if self.attachments.len() > 10 {
            return Err(EmailError::TooManyAttachments(self.attachments.len()));
        }

        // Verify agent ID matches email local part
        let email_local = self.to.split('@').next().unwrap_or("").to_lowercase();
        if self.agent_id != email_local {
            return Err(EmailError::AgentIdMismatch {
                email_local,
                agent_id: self.agent_id.clone(),
            });
        }

        // Validate timestamp
        chrono::DateTime::parse_from_rfc3339(&self.timestamp)
            .map_err(|_| EmailError::InvalidEmail("Invalid timestamp format".to_string()))?;

        Ok(())
    }

    /// Extract agent ID from email address
    pub fn extract_agent_id(email: &str) -> Option<String> {
        let local = email.split('@').next()?.to_lowercase();
        let agent_id_regex = regex::Regex::new(r"^[a-z0-9][a-z0-9-]{2,29}$").ok()?;
        if agent_id_regex.is_match(&local) {
            Some(local)
        } else {
            None
        }
    }
}

impl SendEmailRequest {
    /// Create a new send email request with template
    pub fn with_template(
        to: impl Into<String>,
        subject: impl Into<String>,
        template: TemplateName,
        template_data: Value,
    ) -> Self {
        Self {
            to: to.into(),
            subject: subject.into(),
            html: None,
            text: None,
            react: None,
            template: Some(template),
            template_data: Some(template_data),
            passport: None,
        }
    }

    /// Add passport for authorization
    pub fn with_passport(mut self, passport: PassportClaims) -> Self {
        self.passport = Some(passport);
        self
    }
}