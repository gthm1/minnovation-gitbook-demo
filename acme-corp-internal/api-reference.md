# API Reference

Integration reference for the AlphaX XVision API. All endpoints require an API key, issued during onboarding.

## Authentication

Include your API key as a bearer token on every request:

```
Authorization: Bearer YOUR_API_KEY
```

## Devices

### List devices

```
GET /v1/devices
```

Returns all registered XVision camera devices on your account.

**Example response**

```
{
  "devices": [
    { "id": "dev_8f2a", "name": "Loading Dock Camera 1", "status": "online" },
    { "id": "dev_9c1b", "name": "Entrance Camera", "status": "offline" }
  ]
}
```

## Telemetry

### Get device events

```
GET /v1/devices/{device_id}/events
```

| Parameter   | Type     | Description                                     |
| ----------- | -------- | ----------------------------------------------- |
| from        | ISO 8601 | Start of the time range                         |
| to          | ISO 8601 | End of the time range                           |
| event\_type | string   | Optional filter, e.g. motion, vehicle\_detected |

## Alerts

### Subscribe to alerts

```
POST /v1/alerts/subscribe

{
  "device_id": "dev_8f2a",
  "webhook_url": "https://your-endpoint.example.com/alerts"
}
```

## User Login & Activity History

Retrieve login and activity history for a specific user on your account.

```
GET /v1/users/{user_id}/activity
```

**Auth:** Requires an API key with the account:read scope.

| Parameter | Type     | Required | Description                                 |
| --------- | -------- | -------- | ------------------------------------------- |
| user\_id  | string   | Yes      | The user to retrieve activity for           |
| from      | ISO 8601 | No       | Start of the time range                     |
| to        | ISO 8601 | No       | End of the time range                       |
| limit     | integer  | No       | Max records to return (default 50, max 200) |

**Notes**

* Activity records are retained for 90 days
* The limit parameter caps at 200 records per request; use from/to to page through longer ranges
