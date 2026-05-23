# Leopards Courier Service (LCS) — API Documentation v2.0

---

## Base URLs

| Environment | URL |
|---|---|
| Staging | `https://merchantapistaging.leopardscourier.com/api/` |
| Production | `https://merchantapi.leopardscourier.com/api/` |

---

## Authentication

Credentials are passed in every request body as:

```json
{
  "api_key": "your_api_key",
  "api_password": "your_api_password"
}
```

To obtain live credentials, log in to your Leopards account → **API Settings** → **API Management** → generate your key and set your password.

---

## Table of Contents

1. [Get All Cities](#1-get-all-cities)
2. [Track Booked Packet](#2-track-booked-packet)
3. [Book a Packet](#3-book-a-packet)
4. [Batch Book Packet](#4-batch-book-packet)
5. [Cancel Booked Packets](#5-cancel-booked-packets)
6. [Generate Load Sheet](#6-generate-load-sheet)
7. [Download Load Sheet](#7-download-load-sheet)
8. [Get Booked Packet Last Statuses By Date Range](#8-get-booked-packet-last-statuses-by-date-range)
9. [Shipper Advice List (Basic)](#9-shipper-advice-list-basic)
10. [Get Shipment Details By Order ID(s)](#10-get-shipment-details-by-order-ids)
11. [Get All Banks](#11-get-all-banks)
12. [Create Shipper](#12-create-shipper)
13. [Get Payment Details By CN Number(s)](#13-get-payment-details-by-cn-numbers)
14. [Get Tariff Details](#14-get-tariff-details)
15. [Get Shipping Charges](#15-get-shipping-charges)
16. [Get Shipper Details](#16-get-shipper-details)
17. [Get Electronic Proof Of Delivery](#17-get-electronic-proof-of-delivery)
18. [Shipper Advice List (Advanced)](#18-shipper-advice-list-advanced)
19. [Activity Log](#19-activity-log)
20. [Add / Update Shipper Advices](#20-add--update-shipper-advices)

---

## 1. Get All Cities

Returns a list of all cities along with their origin and destination eligibility.

**Method:** `POST`
**Endpoint:** `/getAllCities/format/json/`

### Request

```bash
curl -X POST "https://merchantapi.leopardscourier.com/api/getAllCities/format/json/" \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "your_api_key",
    "api_password": "your_api_password"
  }'
```

### Request Fields

| Field | Type | Required | Description |
|---|---|---|---|
| api_key | String | Yes | Your API key |
| api_password | String | Yes | Your API password |

### Response — Success

```json
{
  "status": 1,
  "error": "0",
  "city_list": [
    {
      "id": 592,
      "name": "KARACHI",
      "shipment_type": ["overnight", "express"],
      "allow_as_origin": true,
      "allow_as_destination": true
    },
    {
      "id": 789,
      "name": "LAHORE",
      "shipment_type": ["overnight", "express", "same_day"],
      "allow_as_origin": true,
      "allow_as_destination": true
    }
  ]
}
```

### Response — Error

```json
{
  "status": 0,
  "error": "Invalid API credentials",
  "city_list": null
}
```

---

## 2. Track Booked Packet

Track one or more packets using their CN/tracking numbers.

**Method:** `POST`
**Endpoint:** `/trackBookedPacket/format/json/`

### Request

```bash
curl -X POST "https://merchantapi.leopardscourier.com/api/trackBookedPacket/format/json/" \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "your_api_key",
    "api_password": "your_api_password",
    "track_numbers": "XXYYYYYYYY"
  }'
```

> For multiple tracking numbers: `"track_numbers": "XXYYYYYYYY,XXYYYYYYYY"` (comma-separated, 10 digits each)

> For direct GET access: `?api_key=XXXX&api_password=XXXX&track_numbers=XXXXXXXX`

### Request Fields

| Field | Type | Required | Description |
|---|---|---|---|
| api_key | String | Yes | Your API key |
| api_password | String | Yes | Your API password |
| track_numbers | String | Yes | Single or comma-separated CN numbers (10 digits each) |

### Response — Success

```json
{
  "status": 1,
  "error": 0,
  "packet_list": [
    {
      "booking_date": "01/01/2024",
      "track_number": "XXYYYYYYYY",
      "track_number_short": 12345,
      "booked_packet_weight": 1000,
      "booked_packet_vol_weight_w": 10,
      "booked_packet_vol_weight_h": 10,
      "booked_packet_vol_weight_l": 10,
      "booked_packet_no_piece": 1,
      "booked_packet_collect_amount": 1500,
      "booked_packet_order_id": "ORD-001",
      "origin_city_name": "Karachi",
      "destination_city_name": "Lahore",
      "invoice_number": "INV-001",
      "invoice_date": "2024-01-01",
      "shipment_name_eng": "My Store",
      "shipment_email": "store@example.com",
      "shipment_phone": 923001234567,
      "shipment_address": "123 Main St, Karachi",
      "consignment_name_eng": "John Doe",
      "consignment_email": "john@example.com",
      "consignment_phone": 923001234567,
      "consignment_phone_two": null,
      "consignment_phone_three": null,
      "consignment_address": "456 Side St, Lahore",
      "special_instructions": "Handle with care",
      "booked_packet_status": "In Transit",
      "activity_date": "2024-01-02",
      "status_remarks": "Out for delivery",
      "reverseCN": "KI000000001",
      "Tracking Detail": [
        {
          "Staus": "In Transit",
          "Reciever Name": "",
          "Activity Date": "2024-01-02",
          "Reason": ""
        }
      ]
    }
  ]
}
```

### Response — Error

```json
{
  "status": 0,
  "error": "Invalid tracking number",
  "packet_list": null
}
```

---

## 3. Book a Packet

Create a new shipment booking.

**Method:** `POST`
**Endpoint:** `/bookPacket/format/json/`

### Request

```bash
curl -X POST "https://merchantapi.leopardscourier.com/api/bookPacket/format/json/" \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "your_api_key",
    "api_password": "your_api_password",
    "booked_packet_weight": 1000,
    "booked_packet_vol_weight_w": "",
    "booked_packet_vol_weight_h": "",
    "booked_packet_vol_weight_l": "",
    "booked_packet_no_piece": 1,
    "booked_packet_collect_amount": 1500,
    "booked_packet_order_id": "ORD-001",
    "origin_city": "self",
    "destination_city": 789,
    "shipment_id": 123,
    "shipment_name_eng": "self",
    "shipment_email": "self",
    "shipment_phone": "self",
    "shipment_address": "self",
    "consignment_name_eng": "John Doe",
    "consignment_email": "",
    "consignment_phone": "03001234567",
    "consignment_phone_two": "",
    "consignment_phone_three": "",
    "consignment_address": "House 1, Street 2, Lahore",
    "special_instructions": "Handle with care",
    "shipment_type": "",
    "custom_data": "",
    "return_address": "",
    "return_city": "",
    "is_vpc": ""
  }'
```

### Request Fields

| Field | Type | Required | Description |
|---|---|---|---|
| api_key | String | Yes | Your API key |
| api_password | String | Yes | Your API password |
| booked_packet_weight | Int | Yes | Weight in grams (e.g. 2000) |
| booked_packet_vol_weight_w | Int | Optional | Volumetric weight — width |
| booked_packet_vol_weight_h | Int | Optional | Volumetric weight — height |
| booked_packet_vol_weight_l | Int | Optional | Volumetric weight — length |
| booked_packet_no_piece | Int | Yes | Number of pieces |
| booked_packet_collect_amount | Int | Yes | COD amount to collect on delivery |
| booked_packet_order_id | String | Optional | Your internal order ID |
| origin_city | String | Yes | `"self"` or city integer ID |
| destination_city | String | Yes | `"self"` or city integer ID |
| shipment_id | Int | Yes | Shipper ID |
| shipment_name_eng | String | Yes | `"self"` or custom shipper name |
| shipment_email | String | Yes | `"self"` or custom shipper email |
| shipment_phone | String | Yes | `"self"` or custom shipper phone |
| shipment_address | String | Yes | `"self"` or custom shipper address |
| consignment_name_eng | String | Yes | Consignee name |
| consignment_email | String | Optional | Consignee email |
| consignment_phone | String | Yes | Consignee phone |
| consignment_phone_two | String | Optional | Consignee second phone |
| consignment_phone_three | String | Optional | Consignee third phone |
| consignment_address | String | Yes | Consignee address |
| special_instructions | String | Yes | Delivery instructions |
| shipment_type | String | Optional | Shipment type name (default: `"overnight"`) |
| custom_data | JSON Array | Optional | Custom key-value data e.g. `[{"key1":"val1"}]` |
| return_address | String | Optional | Return address (defaults to shipper address) |
| return_city | Int | Optional | Return city ID (defaults to shipper origin city) |
| is_vpc | Int | Optional | Set `1` if VPC; `booked_packet_order_id` must be a CN number |

### Response — Success

```json
{
  "status": 1,
  "error": 0,
  "track_number": "XXYYYYYYYY",
  "slip_link": "https://merchantapi.leopardscourier.com/slip/XXYYYYYYYY"
}
```

### Response — Error

```json
{
  "status": 0,
  "error": "Consignee phone is required",
  "track_number": null,
  "slip_link": null
}
```

---

## 4. Batch Book Packet (NOT WORKING ANYMORE DO NOT USE IT)

Book multiple packets in a single API call.

**Method:** `POST`
**Endpoint:** `/batchBookPacketv2/format/json/`

### Request

```bash
curl -X POST "https://merchantapi.leopardscourier.com/api/batchBookPacketv2/format/json/" \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "your_api_key",
    "api_password": "your_api_password",
    "packets": [
      {
        "booked_packet_weight": 1000,
        "booked_packet_vol_weight_w": "",
        "booked_packet_vol_weight_h": "",
        "booked_packet_vol_weight_l": "",
        "booked_packet_no_piece": 1,
        "booked_packet_collect_amount": 1500,
        "booked_packet_order_id": "ORD-001",
        "origin_city": "self",
        "destination_city": 789,
        "shipment_id": 123,
        "shipment_name_eng": "self",
        "shipment_email": "self",
        "shipment_phone": "self",
        "shipment_address": "self",
        "consignment_name_eng": "John Doe",
        "consignment_email": "",
        "consignment_phone": "03001234567",
        "consignment_phone_two": "",
        "consignment_phone_three": "",
        "consignment_address": "House 1, Street 2, Lahore",
        "special_instructions": "Handle with care",
        "shipment_type": "",
        "custom_data": "",
        "return_address": "",
        "return_city": "",
        "is_vpc": ""
      },
      {
        "booked_packet_weight": 500,
        "booked_packet_no_piece": 1,
        "booked_packet_collect_amount": 800,
        "booked_packet_order_id": "ORD-002",
        "origin_city": "self",
        "destination_city": 592,
        "shipment_id": 123,
        "shipment_name_eng": "self",
        "shipment_email": "self",
        "shipment_phone": "self",
        "shipment_address": "self",
        "consignment_name_eng": "Jane Doe",
        "consignment_phone": "03111234567",
        "consignment_address": "789 North Ave, Karachi",
        "special_instructions": "Fragile"
      }
    ]
  }'
```

### Request Fields

Same as [Book a Packet](#3-book-a-packet) per packet object, wrapped inside a `packets` array.

### Response — Success

```json
{
  "status": 1,
  "error": 0,
  "data": [
    {
      "track_number": "XXYYYYYYYY",
      "booked_packet_order_id": "ORD-001",
      "slip_link": "https://merchantapi.leopardscourier.com/slip/XXYYYYYYYY"
    },
    {
      "track_number": "XXYYYYYYYY",
      "booked_packet_order_id": "ORD-002",
      "slip_link": "https://merchantapi.leopardscourier.com/slip/XXYYYYYYYY"
    }
  ]
}
```

### Response — Error

```json
{
  "status": 0,
  "error": {
    "bookPacket - 0": {
      "booked_packet_weight": "Packet Weight is required",
      "booked_packet_no_piece": "No. of Pieces is required",
      "booked_packet_collect_amount": "COD Amount is required",
      "origin_city": "Origin City is required",
      "destination_city": "Destination City is required",
      "consignment_name_eng": "Consignee Name is required",
      "consignment_phone": "Consignee Phone is required",
      "consignment_address": "Consignee Address is required",
      "special_instructions": "Special Instructions are required"
    }
  }
}
```

---

## 5. Cancel Booked Packets

Cancel one or more booked shipments by CN number.

**Method:** `POST`
**Endpoint:** `/cancelBookedPackets/format/json/`

### Request

```bash
curl -X POST "https://merchantapi.leopardscourier.com/api/cancelBookedPackets/format/json/" \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "your_api_key",
    "api_password": "your_api_password",
    "cn_numbers": "XXYYYYYYYY,XXYYYYYYYY"
  }'
```

### Request Fields

| Field | Type | Required | Description |
|---|---|---|---|
| api_key | String | Yes | Your API key |
| api_password | String | Yes | Your API password |
| cn_numbers | String | Yes | Single or comma-separated CN numbers (10 digits each) |

### Response — Success

```json
{
  "status": "1",
  "error": "null"
}
```

### Response — Error

```json
{
  "status": 0,
  "error": {
    "XXYYYYYYYY": "CN already cancelled or not found"
  }
}
```

---

## 6. Generate Load Sheet

Generate a load sheet for a set of CN numbers.

**Method:** `POST`
**Endpoint:** `/generateLoadSheet/format/json/`

### Request

```bash
curl -X POST "https://merchantapi.leopardscourier.com/api/generateLoadSheet/format/json/" \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "your_api_key",
    "api_password": "your_api_password",
    "cn_numbers": ["XXYYYYYYY1", "XXYYYYYYY2", "XXYYYYYYY3"],
    "courier_name": "courier_name",
    "courier_code": "courier_code"
  }'
```

### Request Fields

| Field | Type | Required | Description |
|---|---|---|---|
| api_key | String | Yes | Your API key |
| api_password | String | Yes | Your API password |
| cn_numbers | Array | Yes | Array of CN numbers (10 digits each) |
| courier_name | String | Yes | Courier name |
| courier_code | String | Yes | Courier code |

### Response — Success

```json
{
  "status": "1",
  "error": "null",
  "load_sheet_id": "generated_loadsheet_id"
}
```

### Response — Error

```json
{
  "status": 0,
  "error": {
    "XXYYYYYYYY": "CN not found or already on a load sheet"
  }
}
```

---

## 7. Download Load Sheet

Download a previously generated load sheet as JSON data or a PDF file.

**Method:** `POST`
**Endpoint:** `/downloadLoadSheet/`

### Request

```bash
curl -X POST "https://merchantapi.leopardscourier.com/api/downloadLoadSheet/" \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "your_api_key",
    "api_password": "your_api_password",
    "load_sheet_id": 123456,
    "response_type": "JSON"
  }'
```

> Set `"response_type": "PDF"` to receive binary PDF data instead.

### Request Fields

| Field | Type | Required | Description |
|---|---|---|---|
| api_key | String | Yes | Your API key |
| api_password | String | Yes | Your API password |
| load_sheet_id | Int | Yes | Load sheet ID from Generate Load Sheet |
| response_type | String | Yes | `"JSON"` or `"PDF"` |

### Response — Success (JSON)

```json
{
  "status": 1,
  "error": "",
  "data": [
    {
      "booking_date": "2024/01/01",
      "track_number": "XXYYYYYYYY",
      "track_number_short": 12345,
      "booked_packet_weight": 1000,
      "booked_packet_no_piece": 1,
      "booked_packet_collect_amount": 1500,
      "booked_packet_order_id": "ORD-001",
      "origin_city_id": 592,
      "destination_city_id": 789,
      "shipment_name_eng": "My Store",
      "shipment_email": "store@example.com",
      "shipment_phone": 923001234567,
      "shipment_address": "123 Main St, Karachi",
      "consignment_name_eng": "John Doe",
      "consignment_email": "john@example.com",
      "consignment_phone": 923001234567,
      "consignment_phone_two": null,
      "consignment_phone_three": null,
      "consignment_address": "456 Side St, Lahore",
      "special_instructions": "Handle with care",
      "shipment_type_id": 1,
      "shipment_type_name": "overnight"
    }
  ]
}
```

### Response — Success (PDF)

Returns binary PDF data. Save it like:

```php
file_put_contents("loadsheet.pdf", $response);
header('Content-Type: application/pdf');
header('Content-Disposition: attachment; filename="loadsheet.pdf"');
readfile("loadsheet.pdf");
```

### Response — Error

```json
{
  "status": 0,
  "error": "Invalid load sheet ID"
}
```

---

## 8. Get Booked Packet Last Statuses By Date Range

Fetch the latest status of all packets booked within a date range.

**Method:** `GET`
**Endpoint:** `/getBookedPacketLastStatus/format/json/`

### Request

```bash
curl -X GET "https://merchantapi.leopardscourier.com/api/getBookedPacketLastStatus/format/json/?api_key=your_api_key&api_password=your_api_password&from_date=2024-01-01&to_date=2024-01-31"
```

### Request Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| api_key | String | Yes | Your API key |
| api_password | String | Yes | Your API password |
| from_date | String | Yes | Start date (`YYYY-MM-DD`) |
| to_date | String | Yes | End date (`YYYY-MM-DD`) |

### Response — Success

```json
{
  "status": 1,
  "error": 0,
  "packet_list": [
    {
      "booking_date": "2024-01-01",
      "delivery_date": "2024-01-03",
      "tracking_number": "KI123456789",
      "booked_packet_weight": "250",
      "arival_dispatch_weight": "0",
      "booked_packet_order_id": "ORD-001",
      "origin_city": "Karachi",
      "destination_city": "Lahore",
      "consignment_name_eng": "John Doe",
      "consignment_phone": "03451234567",
      "consignment_address": "House no. 420, ABC street",
      "booked_packet_status": "Delivered",
      "cod_value": "1500.00"
    }
  ]
}
```

### Response — Error

```json
{
  "status": 0,
  "error": "Invalid date range",
  "packet_list": null
}
```

---

## 9. Shipper Advice List (Basic)

Get a list of shipper advices filtered by date range and optional city filters.

**Method:** `POST`
**Endpoint:** `/shipperAdviceList/format/json/`

### Request

```bash
curl -X POST "https://merchantapi.leopardscourier.com/api/shipperAdviceList/format/json/" \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "your_api_key",
    "api_password": "your_api_password",
    "from_date": "2024-01-01",
    "to_date": "2024-01-31",
    "origin_city": 592,
    "destination_city": 789
  }'
```

### Request Fields

| Field | Type | Required | Description |
|---|---|---|---|
| api_key | String | Yes | Your API key |
| api_password | String | Yes | Your API password |
| from_date | Date | Yes | Start date (`YYYY-MM-DD`) |
| to_date | Date | Yes | End date (`YYYY-MM-DD`) |
| origin_city | Int | Optional | Origin city ID |
| destination_city | Int | Optional | Destination city ID |

### Response — Success

```json
{
  "status": 1,
  "error": "",
  "packet_list": [
    {
      "track_number": "XXYYYYYYYY",
      "booked_packet_date": "2024/01/01",
      "consignment_name_eng": "John Doe",
      "consignment_phone": "03001234567",
      "consignment_address": "456 Side St, Lahore",
      "booked_packet_collect_amount": "1500",
      "origin_city_id": 592,
      "destination_city_id": 789,
      "origin_city_name": "Karachi",
      "destination_city_name": "Lahore",
      "booked_packet_status": "Pending",
      "pending_reason": "Customer not available",
      "shipment_name_eng": "My Store",
      "advice_text": 1,
      "advice_date_created": 1704067200
    }
  ]
}
```

### Response — Error

```json
{
  "status": 0,
  "error": "Invalid date format"
}
```

---

## 10. Get Shipment Details By Order ID(s)

Fetch full shipment details using your internal order IDs.

**Method:** `POST`
**Endpoint:** `/getShipmentDetailsByOrderID/format/json/`

### Request

```bash
curl -X POST "https://merchantapi.leopardscourier.com/api/getShipmentDetailsByOrderID/format/json/" \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "your_api_key",
    "api_password": "your_api_password",
    "shipment_order_id": ["ORD-001", "ORD-002", "ORD-003"]
  }'
```

### Request Fields

| Field | Type | Required | Description |
|---|---|---|---|
| api_key | String | Yes | Your API key |
| api_password | String | Yes | Your API password |
| shipment_order_id | Array | Yes | Array of order ID strings |

### Response — Success

```json
{
  "status": 1,
  "error": "",
  "data": [
    {
      "booking_date": "2024/01/01",
      "track_number": "XXYYYYYYYY",
      "booked_packet_weight": "1000",
      "booked_packet_no_piece": "1",
      "booked_packet_collect_amount": "1500",
      "booked_packet_order_id": "ORD-001",
      "origin_city": "Karachi",
      "destination_city": "Lahore",
      "shipment_name_eng": "My Store",
      "shipment_email": "store@example.com",
      "shipment_phone": "923001234567",
      "shipment_address": "123 Main St, Karachi",
      "consignment_name_eng": "John Doe",
      "consignment_email": "john@example.com",
      "consignment_phone": "923001234567",
      "consignment_phone_two": "",
      "consignment_phone_three": "",
      "consignment_address": "456 Side St, Lahore",
      "special_instructions": "Handle with care",
      "shipment_type_name": "overnight",
      "booked_packet_status": "Delivered",
      "delivery_date": "2024-01-03",
      "return_date": "",
      "invoice_number": "INV-001",
      "invoice_date": "2024-01-01"
    }
  ]
}
```

### Response — Error

```json
{
  "status": 0,
  "error": "Order ID not found"
}
```

---

## 11. Get All Banks

Retrieve a list of all banks available for shipper account setup.

**Method:** `POST`
**Endpoint:** `/getBankList/format/json/`

### Request

```bash
curl -X POST "https://merchantapi.leopardscourier.com/api/getBankList/format/json/" \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "your_api_key",
    "api_password": "your_api_password"
  }'
```

### Request Fields

| Field | Type | Required | Description |
|---|---|---|---|
| api_key | String | Yes | Your API key |
| api_password | String | Yes | Your API password |

### Response — Success

```json
{
  "status": 1,
  "error": "0",
  "bank_list": [
    {
      "bank_id": 1,
      "bank_name_eng": "HBL"
    },
    {
      "bank_id": 2,
      "bank_name_eng": "MCB"
    }
  ]
}
```

### Response — Error

```json
{
  "status": 0,
  "error": "Authentication failed",
  "bank_list": null
}
```

---

## 12. Create Shipper

Register a new shipper account under your merchant account.

**Method:** `POST`
**Endpoint:** `/createShipper/format/json/`

### Request

```bash
curl -X POST "https://merchantapi.leopardscourier.com/api/createShipper/format/json/" \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "your_api_key",
    "api_password": "your_api_password",
    "shipment_name": "My Store",
    "shipment_email": "store@example.com",
    "shipment_phone": "03001234567",
    "shipment_address": "123 Main St, Karachi",
    "bank_id": 1,
    "bank_account_no": "1234567890",
    "bank_account_title": "My Store Account",
    "bank_branch": "Clifton Branch",
    "bank_account_iban_no": "PK00HBL0000001234567890",
    "city_id": "592",
    "cnic": "42101-1234567-1",
    "return_address": "123 Main St, Karachi"
  }'
```

### Request Fields

| Field | Type | Required | Description |
|---|---|---|---|
| api_key | String | Yes | Your API key |
| api_password | String | Yes | Your API password |
| shipment_name | String | Yes | Shipper business name |
| shipment_email | String | Optional | Shipper email |
| shipment_phone | String | Yes | Shipper phone |
| shipment_address | String | Yes | Shipper address |
| bank_id | Int | Yes | Bank ID from Get All Banks |
| bank_account_no | String | Optional | Bank account number |
| bank_account_title | String | Optional | Account title |
| bank_branch | String | Optional | Branch name |
| bank_account_iban_no | String | Optional | IBAN number |
| city_id | String | Yes | City ID from Get All Cities |
| cnic | String | Optional | CNIC number |
| return_address | String | Optional | Return address (defaults to shipment_address) |

### Response — Success (New Shipper)

```json
{
  "status": 1,
  "error": "0",
  "message": "Shipper added successfully.",
  "data": [
    {
      "shipment_id": 456,
      "shipment_name": "My Store",
      "shipment_email": "store@example.com",
      "shipment_phone": "03001234567",
      "shipment_address": "123 Main St, Karachi",
      "city_id": 592,
      "bank_id": 1,
      "bank_account_no": "1234567890",
      "bank_account_title": "My Store Account",
      "bank_branch": "Clifton Branch",
      "bank_account_iban_no": "PK00HBL0000001234567890",
      "username": "mystore_user",
      "user_password": "generated_password",
      "cnic": "42101-1234567-1",
      "return_address": "123 Main St, Karachi"
    }
  ]
}
```

### Response — Success (Shipper Already Exists)

```json
{
  "status": 1,
  "error": "0",
  "message": "Shipper already exists.",
  "data": [
    {
      "shipment_id": 456,
      "shipment_name": "My Store",
      "shipment_email": "store@example.com",
      "shipment_phone": "03001234567",
      "shipment_address": "123 Main St, Karachi",
      "city_id": 592,
      "bank_id": 1,
      "bank_account_no": "1234567890",
      "bank_account_title": "My Store Account",
      "bank_branch": "Clifton Branch",
      "bank_account_iban_no": "PK00HBL0000001234567890",
      "cnic": "42101-1234567-1",
      "return_address": "123 Main St, Karachi"
    }
  ]
}
```

### Response — Error

```json
{
  "status": 0,
  "error": "Shipper phone is required"
}
```

---

## 13. Get Payment Details By CN Number(s)

Retrieve payment/settlement details for up to 50 CN numbers.

**Method:** `GET`
**Endpoint:** `/getPaymentDetails/format/json/`

### Request

```bash
curl -X GET "https://merchantapi.leopardscourier.com/api/getPaymentDetails/format/json/?api_key=your_api_key&api_password=your_api_password&cn_numbers=XXYYYYYYYY,XXYYYYYYYY"
```

> Up to 50 CN numbers can be provided, comma-separated.

### Request Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| api_key | String | Yes | Your API key |
| api_password | String | Yes | Your API password |
| cn_numbers | String | Yes | Comma-separated CN numbers (max 50) |

### Response — Success

```json
{
  "status": 1,
  "error": "0",
  "payment_list": [
    {
      "booked_packet_cn": 1234567890,
      "billing_method": "COD",
      "status": "Paid",
      "invoice_cheque_no": "CHQ-001",
      "invoice_cheque_date": "2024-01-15",
      "payment_method": "Cheque",
      "message": "Payment processed",
      "slip_link": "https://merchantapi.leopardscourier.com/payment_slip/1234"
    }
  ]
}
```

### Response — Error

```json
{
  "status": 0,
  "error": "CN number not found",
  "payment_list": null
}
```

---

## 14. Get Tariff Details

Calculate shipping charges for a given weight, route, and shipment type.

**Method:** `GET`
**Endpoint:** `/getTariffDetails/format/json/`

### Request

```bash
curl -X GET "https://merchantapi.leopardscourier.com/api/getTariffDetails/format/json/?api_key=your_api_key&api_password=your_api_password&packet_weight=1000&shipment_type=1&origin_city=592&destination_city=789&cod_amount=1500"
```

### Request Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| api_key | String | Yes | Your API key |
| api_password | String | Yes | Your API password |
| packet_weight | Int | Yes | Packet weight in grams |
| shipment_type | Int | Yes | Shipment type ID |
| origin_city | Int | Yes | Origin city ID |
| destination_city | Int | Yes | Destination city ID |
| cod_amount | Int | Yes | COD amount (use `0` for prepaid) |

### Response — Success

```json
{
  "status": 1,
  "error": "0",
  "packet_charges": {
    "shipment_charges": "250",
    "cash_handling": "30",
    "insurance_charges": "0",
    "gst_percentage": "15",
    "gst_amount": "42",
    "fuel_surcharge_percentage": "5",
    "fuel_surcharge_amount": "14"
  }
}
```

### Response — Error

```json
{
  "status": 0,
  "error": "Invalid origin or destination city",
  "packet_charges": null
}
```

---

## 15. Get Shipping Charges

Get actual billed shipping charges for existing CN numbers.

**Method:** `GET`
**Endpoint:** `/getShippingCharges/format/json/`

### Request

```bash
curl -X GET "https://merchantapi.leopardscourier.com/api/getShippingCharges/format/json/?api_key=your_api_key&api_password=your_api_password&cn_numbers=XXYYYYYYYY,XXYYYYYYYY"
```

> Up to 50 CN numbers, comma-separated.

### Request Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| api_key | String | Yes | Your API key |
| api_password | String | Yes | Your API password |
| cn_numbers | String | Yes | Comma-separated CN numbers (max 50) |

### Response — Success

```json
{
  "status": 1,
  "error": "0",
  "data": [
    {
      "cn_number": "XXYYYYYYYY",
      "billing_method": "COD",
      "invoice_cheque_no": "INV-2024-001",
      "invoice_cheque_date": "2024-01-15",
      "weight_charged": 1000,
      "shipment_charges": 250,
      "cash_handling_charges": 30,
      "return_charges": 0,
      "insurance_charges": 0,
      "fuel_surcharge_percentage": 5,
      "fuel_surcharge_amount": 14,
      "gst": 15,
      "gst_amount": 42,
      "booked_packet_collect_amount": 1500,
      "billed_charges": 336,
      "old_invoice_no": "",
      "net_charges": 336,
      "gross_charges": 336
    }
  ]
}
```

### Response — Error

```json
{
  "status": 0,
  "error": "CN number not found"
}
```

---

## 16. Get Shipper Details

Retrieve shipper profile information by a custom search parameter.

**Method:** `GET`
**Endpoint:** `/getShipperDetails/format/json/`

### Request

```bash
curl -X GET "https://merchantapi.leopardscourier.com/api/getShipperDetails/format/json/?api_key=your_api_key&api_password=your_api_password&request_param=shipment_phone&request_value=03001234567" \
  -H "Content-Type: application/json"
```

### Request Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| api_key | String | Yes | Your API key |
| api_password | String | Yes | Your API password |
| request_param | String | Yes | Search field name (e.g. `shipment_phone`) |
| request_value | String | Yes | Value to search for |

### Response — Success

```json
{
  "status": 1,
  "error": "0",
  "data": [
    {
      "shipment_id": 456,
      "shipment_name_eng": "My Store",
      "shipment_contact_person": "Ali Khan",
      "shipment_email": "store@example.com",
      "shipment_phone": 923001234567,
      "shipment_address": "123 Main St, Karachi",
      "bank_id": 1,
      "bank_name_eng": "HBL",
      "bank_account_no": "1234567890",
      "bank_account_title": "My Store Account",
      "bank_branch": "Clifton Branch",
      "bank_account_iban_no": "PK00HBL0000001234567890",
      "is_settlement": 0,
      "cnic": "42101-1234567-1",
      "return_address": "123 Main St, Karachi",
      "shipper_city_id": 592
    }
  ]
}
```

### Response — Error

```json
{
  "status": 0,
  "error": "Shipper not found"
}
```

---

## 17. Get Electronic Proof Of Delivery

Get ePOD details including signature, receiver info, GPS coordinates, and delivery status.

**Method:** `GET`
**Endpoint:** `/getElectronicProofOfDelivery/format/json`

### Request

```bash
curl -X GET "https://merchantapi.leopardscourier.com/api/getElectronicProofOfDelivery/format/json/?api_key=your_api_key&api_password=your_api_password&cn_number=XXYYYYYYYY,XXYYYYYYYY"
```

> Up to 50 CN numbers, comma-separated.

### Request Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| api_key | String | Yes | Your API key |
| api_password | String | Yes | Your API password |
| cn_number | String | Yes | Comma-separated CN numbers (max 50) |

### Response — Success

```json
{
  "status": 1,
  "error": "0",
  "data": [
    {
      "XXYYYYYYYY": {
        "City_Name": "Lahore",
        "CN_Number": "XXYYYYYYYY",
        "Arrival_Date": "2024-01-03",
        "Status": "Delivered",
        "Status_Detail": "Package delivered successfully",
        "Cour_Code": 101,
        "Cour_Name": "Rider Name",
        "Receiver_Name": "John Doe",
        "Relation": "Self",
        "Reason": "",
        "Pcs": "1",
        "Weight": 1000,
        "Latitude": 31.5204,
        "Longitude": 74.3587,
        "Sig_Url": "https://leopardscourier.com/signatures/abc123.png",
        "Activity": "Delivered"
      }
    }
  ]
}
```

### Response — Error

```json
{
  "status": 0,
  "error": "CN number not found"
}
```

---

## 18. Shipper Advice List (Advanced)

Advanced version of the shipper advice list with pagination, product, and status filters.

**Method:** `POST`
**Endpoint:** `/shipperAdviceList/format/json/`

### Request

```bash
curl -X POST "https://merchantapi.leopardscourier.com/api/shipperAdviceList/format/json/" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "api_key": "your_api_key",
    "api_password": "your_api_password",
    "product": "",
    "status": "",
    "origionID": "",
    "destinationID": "",
    "dateFrom": "2024-01-01",
    "toDate": "2024-01-31",
    "Cn_number": "",
    "start": 0,
    "length": 100
  }'
```

### Request Fields

| Field | Type | Required | Description |
|---|---|---|---|
| api_key | String | Yes | Your API key |
| api_password | String | Yes | Your API password |
| product | String | Optional | Product/shipment type filter |
| status | String | Optional | Status filter |
| origionID | String | Optional | Origin city ID filter |
| destinationID | String | Optional | Destination city ID filter |
| dateFrom | String | Optional | Start date (`YYYY-MM-DD`) |
| toDate | String | Optional | End date (`YYYY-MM-DD`) |
| Cn_number | String | Optional | CN number filter |
| start | Int | Optional | Pagination offset (default: 0) |
| length | Int | Optional | Page size (default: 100) |

### Response — Success

```json
{
  "status": "1",
  "error": "0",
  "totalrecords": 1,
  "data": [
    {
      "id": 9876,
      "cn_number": "XXYYYYYYYY",
      "origin_id": 592,
      "courier_id": 101,
      "cour_date": "2024-01-01",
      "cour_time": null,
      "dest_id": 789,
      "product": "overnight",
      "shipper_name": "My Store",
      "shipper_address": "123 Main St, Karachi",
      "shipper_mobile": "03001234567",
      "consignee_name": "John Doe",
      "consignee_address": "456 Side St, Lahore",
      "consignee_mobile": "03001234567",
      "status": "Pending",
      "reason": "Customer not available",
      "client_id": null,
      "shipper_advice_status": "Pending",
      "shipper_remarks": "",
      "created_date": "2024-01-01",
      "created_time": null,
      "remarks": "",
      "delete_type": null,
      "attempt_counter": 0,
      "user_id": 123,
      "station_id": 10,
      "activity": "Pending",
      "orgncityid": "592",
      "origin_name": "Karachi",
      "dstncityid": "789",
      "dst_name": "Lahore",
      "status_description": "Awaiting re-attempt",
      "outcome_status": "Pending",
      "oms_status": "Open"
    }
  ]
}
```

### Response — Error

```json
{
  "status": 0,
  "error": "Authentication failed"
}
```

---

## 19. Activity Log

Fetch the activity log for your shipments with filtering and pagination.

**Method:** `POST`
**Endpoint:** `/activityLog/format/json/`

### Request

```bash
curl -X POST "https://merchantapi.leopardscourier.com/api/activityLog/format/json/" \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "your_api_key",
    "api_password": "your_api_password",
    "product": "",
    "status": "",
    "Cn_number": "XXYYYYYYYY",
    "start": 0,
    "length": 100
  }'
```

### Request Fields

| Field | Type | Required | Description |
|---|---|---|---|
| api_key | String | Yes | Your API key |
| api_password | String | Yes | Your API password |
| product | String | Optional | Product/shipment type filter |
| status | String | Optional | Status filter |
| Cn_number | String | Optional | CN number filter |
| start | Int | Optional | Pagination offset (default: 0) |
| length | Int | Optional | Page size (default: 100) |

### Response — Success

```json
{
  "status": "1",
  "error": "0",
  "totalrecords": 1,
  "data": [
    {
      "id": 9876,
      "cn_number": "XXYYYYYYYY",
      "origin_id": 592,
      "courier_id": 101,
      "cour_date": "2024-01-01",
      "cour_time": null,
      "dest_id": 789,
      "product": "overnight",
      "shipper_name": "My Store",
      "shipper_address": "123 Main St, Karachi",
      "shipper_mobile": "03001234567",
      "consignee_name": "John Doe",
      "consignee_address": "456 Side St, Lahore",
      "consignee_mobile": "03001234567",
      "status": "In Transit",
      "reason": "",
      "client_id": null,
      "shipper_advice_status": "Pending",
      "shipper_remarks": "",
      "created_date": "2024-01-01",
      "created_time": null,
      "remarks": "",
      "delete_type": null,
      "attempt_counter": 1,
      "user_id": 123,
      "station_id": 10,
      "activity": "In Transit",
      "orgncityid": "592",
      "origin_name": "Karachi",
      "dstncityid": "789",
      "dst_name": "Lahore",
      "status_description": "Packet in transit to destination",
      "outcome_status": "In Progress",
      "oms_status": "Open"
    }
  ]
}
```

### Response — Error

```json
{
  "status": 0,
  "error": "Authentication failed"
}
```

---

## 20. Add / Update Shipper Advices

Update the advice status on one or more shipments (e.g. re-attempt or return).

**Method:** `POST`
**Endpoint:** `/updateShipperAdvice/format/json/`

### Request

```bash
curl -X POST "https://merchantapi.leopardscourier.com/api/updateShipperAdvice/format/json/" \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "your_api_key",
    "api_password": "your_api_password",
    "data": [
      {
        "id": 9876,
        "cn_number": "XXYYYYYYYY",
        "shipper_advice_status": "RA",
        "shipper_remarks": "Please re-attempt tomorrow morning"
      },
      {
        "id": 9877,
        "cn_number": "XXYYYYYYYY",
        "shipper_advice_status": "RT",
        "shipper_remarks": "Customer cancelled order, return to sender"
      }
    ]
  }'
```

### Request Fields

| Field | Type | Required | Description |
|---|---|---|---|
| api_key | String | Yes | Your API key |
| api_password | String | Yes | Your API password |
| data | Array | Yes | Array of advice update objects |
| data[].id | Int | Yes | Advice record ID |
| data[].cn_number | String | Yes | CN number |
| data[].shipper_advice_status | String | Yes | `"RA"` (Re-Attempt) or `"RT"` (Return) |
| data[].shipper_remarks | String | Yes | Remarks / instructions |

### Response — Success

```json
{
  "status": "1",
  "error": "0",
  "data": "Shipper Advice Updated successfully"
}
```

### Response — Error

```json
{
  "status": 0,
  "error": "Invalid advice status. Allowed values: RA, RT"
}
```

---

## Status Codes

| `status` Value | Meaning |
|---|---|
| `1` | Success |
| `0` | Failure / Error |

---

## Common Error Scenarios

| Scenario | Likely Cause |
|---|---|
| `"Authentication failed"` | Wrong `api_key` or `api_password` |
| `"CN not found"` | Invalid or non-existent tracking number |
| `"Origin City is required"` | Missing or invalid `origin_city` field |
| `"Packet Weight is required"` | Missing `booked_packet_weight` field |
| `"Invalid date format"` | Date not in `YYYY-MM-DD` format |

---

## Notes

- All `POST` requests must include `Content-Type: application/json` header.
- Weight must always be specified in **grams**.
- For `origin_city` and `destination_city`, use `"self"` to default to your registered shipper city, or provide an integer city ID from the **Get All Cities** endpoint.
- Shipment type defaults to `"overnight"` if left empty.
- The `slip_link` in booking responses is a URL you can open in a browser to download/print the shipment slip.
- For VPC (Value Plus Collection) shipments, set `is_vpc = 1` and ensure `booked_packet_order_id` is a valid CN number.
- Shipper advice statuses: `"RA"` = Re-Attempt, `"RT"` = Return to Sender.