---
tags:
  - public
---

# API Reference

Integration reference for the Xmesh API. All endpoints require an API key, issued during onboarding.

### Authentication

Include your API key as a bearer token on every request:

```
Authorization: Bearer YOUR_API_KEY
```

### Gateways

#### List gateways

```
GET /v1/gateways
```

Returns all registered Xmesh gateways on your account.

**Example response**

```
{
  "gateways": [
    { "id": "gw_3f7c", "name": "Warehouse Gateway 1", "status": "online" },
    { "id": "gw_5a2d", "name": "Outdoor Yard Gateway", "status": "online" }
  ]
}
```

### Sensor readings

#### Get sensor readings

```
GET /v1/sensors/{sensor_id}/readings
```

| Parameter     | Type     | Description                                                 |
| ------------- | -------- | ----------------------------------------------------------- |
| from          | ISO 8601 | Start of the time range                                     |
| to            | ISO 8601 | End of the time range                                       |
| reading\_type | string   | Optional filter, e.g. temperature, humidity, soil\_moisture |

### Alerts

#### Subscribe to alerts

```
POST /v1/alerts/subscribe

{
  "sensor_id": "sn_9d21",
  "webhook_url": "https://your-endpoint.example.com/alerts"
}
```

**Notes**

* Sensor readings are retained for 180 days
* Gateways buffer readings locally for up to 24 hours during connectivity loss
