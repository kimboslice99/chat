$ttl = @{ttl=86400} | ConvertTo-Json
$turnid = "<TURN_ID>"
$turnkey = "<TURN_KEY>"
try {
    $iwr = Invoke-WebRequest -UseBasicParsing -Uri "https://rtc.live.cloudflare.com/v1/turn/keys/$($turnid)/credentials/generate" `
        -Headers @{ 'Authorization' = "Bearer $($turnkey)"; 'Content-Type' = 'application/json' } `
        -Method POST -Body $($ttl)
    
    $body = $iwr.Content
    $iceServers = ($body | ConvertFrom-Json).iceServers

    $newData = $iceServers.urls | ForEach-Object {
        [PSCustomObject]@{
            urls       = $_
            username   = $iceServers.username
            credential = $iceServers.credential
        }
    }

    $responseBody = ($newData | ConvertTo-Json)
    Write-Host $responseBody
} catch {
    # do nothing, powershell cant write to stderr nicely.
    Write-Host '[]'
}
