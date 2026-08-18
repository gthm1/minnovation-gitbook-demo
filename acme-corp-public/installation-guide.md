# Installation Guide

Setup instructions for AlphaX XVision camera and edge devices.

## Requirements

| Requirement | Detail |
|--------------|--------|
| Network | PoE+ switch, minimum 1 port per camera |
| Power | 802.3at PoE+ (25.5W) per camera |
| Bandwidth | 4 Mbps sustained per camera stream |
| Edge device | XVision Edge Node (supplied) |

## Step 1 — Mount the camera

Mount the camera at the location specified in your site survey. Ensure a clear, unobstructed view of the monitored area.

## Step 2 — Connect to the network

1. Connect the camera to a PoE+ port on your switch
2. Confirm the camera's status LED turns solid green within 60 seconds
3. Note the camera's assigned IP address from your DHCP server

## Step 3 — Register the device

    POST /v1/devices/register

    {
      "name": "Loading Dock Camera 1",
      "serial_number": "XV-2A9F-0012",
      "location": "Loading Dock A"
    }

## Step 4 — Verify the stream

Open the AlphaX Cloud dashboard and confirm the device shows **Online** with a live preview. If the preview doesn't load within 2 minutes, see Troubleshooting.

## Firmware updates

Edge Nodes check for firmware updates automatically every 24 hours. To force an immediate check, use the dashboard's **Check for updates** button on the device detail page.
