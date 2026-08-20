# API Reference

Integration reference for the AlphaX Cloud API. All endpoints require an API key, issued during onboarding.

### Authentication

Include your API key as a bearer token on every request:

```
Authorization: Bearer YOUR_API_KEY
```

### Accounts

#### Get account details

```
GET /v1/account
```

Returns your account's configuration and connected products.

**Example response**

```
{
  "account": "AlphaX",
  "products": ["alphax_cloud"],
  "status": "active"
}
```

### Integrations

#### List integrations

```
GET /v1/integrations
```

Returns all active third-party integrations connected to your account.

### Webhooks

#### Register a webhook

```
POST /v1/webhooks/register

{
  "event": "integration.status_changed",
  "webhook_url": "https://your-endpoint.example.com/webhooks"
}
```

**Notes**

* Webhook deliveries are retried up to 3 times on failure
* API keys can be scoped to specific integrations from the dashboard
