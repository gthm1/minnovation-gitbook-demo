# Troubleshooting

Common issues and fixes for your AlphaX XVision deployment.

## Camera shows offline

1. Check the physical PoE connection — confirm the status LED is lit
2. Verify the camera still has a valid IP address from your DHCP server
3. Restart the camera by power-cycling the PoE port
4. If still offline after 5 minutes, check the Edge Node's connectivity to AlphaX Cloud

## Stream preview won't load

| Cause | Fix |
|-------|-----|
| Insufficient bandwidth | Confirm 4 Mbps sustained is available per camera |
| Browser cache | Hard-refresh the dashboard (Ctrl+Shift+R) |
| Firewall blocking | Ensure outbound HTTPS (443) is allowed to *.alphax.cloud |

## Motion alerts not firing

* Confirm your alert subscription webhook is registered and returning a 200 response
* Check the device's sensitivity threshold hasn't been set too high in the dashboard
* Verify the camera's field of view still covers the intended detection zone

## Still stuck?

Contact your account manager with the device ID and a description of the issue.
