$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$DataDir = Join-Path $Root "data"
$CatalogueFile = Join-Path $DataDir "catalogue.json"
$OutDir = Join-Path $DataDir "catalogue"
$OutFile = Join-Path $OutDir "grocery-catalogue.xlsx"

function XmlEscape($Value) {
    if ($null -eq $Value) { return "" }
    return [System.Security.SecurityElement]::Escape([string]$Value)
}

function Get-ColumnName([int]$Index) {
    $name = ""
    while ($Index -gt 0) {
        $Index--
        $name = [char](65 + ($Index % 26)) + $name
        $Index = [math]::Floor($Index / 26)
    }
    return $name
}

function New-SheetXml($Rows, $Headers) {
    $xml = New-Object System.Text.StringBuilder
    [void]$xml.AppendLine('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')
    [void]$xml.AppendLine('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">')
    [void]$xml.AppendLine('<sheetData>')

    $rowIndex = 1
    [void]$xml.AppendLine('<row r="1">')
    for ($i = 0; $i -lt $Headers.Count; $i++) {
        $cell = "$(Get-ColumnName ($i + 1))$rowIndex"
        [void]$xml.AppendLine("<c r=`"$cell`" t=`"inlineStr`"><is><t>$(XmlEscape $Headers[$i])</t></is></c>")
    }
    [void]$xml.AppendLine('</row>')

    foreach ($row in $Rows) {
        $rowIndex++
        [void]$xml.AppendLine("<row r=`"$rowIndex`">")
        for ($i = 0; $i -lt $Headers.Count; $i++) {
            $header = $Headers[$i]
            $value = $row[$header]
            $cell = "$(Get-ColumnName ($i + 1))$rowIndex"
            [void]$xml.AppendLine("<c r=`"$cell`" t=`"inlineStr`"><is><t>$(XmlEscape $value)</t></is></c>")
        }
        [void]$xml.AppendLine('</row>')
    }

    [void]$xml.AppendLine('</sheetData>')
    [void]$xml.AppendLine('</worksheet>')
    return $xml.ToString()
}

if (-not (Test-Path -LiteralPath $CatalogueFile)) {
    throw "Catalogue file not found: $CatalogueFile"
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$catalogue = Get-Content -Raw -LiteralPath $CatalogueFile | ConvertFrom-Json
$headers = @(
    "canonical_id", "canonical_name", "category", "target_size", "search_terms",
    "store_id", "store_name", "product_name", "brand", "size", "unit",
    "price", "regular_price", "savings", "promo_text", "promo_type", "promo_applied",
    "normalised_price_for_target", "normalised_target_size", "status", "message",
    "ingredients", "quantity", "url", "last_matched_url", "last_seen_at"
)

$rows = @()
foreach ($product in @($catalogue)) {
    foreach ($store in @($product.stores)) {
        $row = [ordered]@{}
        $row["canonical_id"] = $product.id
        $row["canonical_name"] = $product.canonicalName
        $row["category"] = $product.category
        $row["target_size"] = $product.targetSize
        $row["search_terms"] = (@($product.searchTerms) -join "; ")
        $row["store_id"] = $store.storeId
        $row["store_name"] = $store.storeName
        $row["product_name"] = $store.productName
        $row["brand"] = $store.brand
        $row["size"] = $store.size
        $row["unit"] = $store.unit
        $row["price"] = $store.price
        $row["regular_price"] = $store.regularPrice
        $row["savings"] = $store.savings
        $row["promo_text"] = $store.promoText
        $row["promo_type"] = $store.promoType
        $row["promo_applied"] = $store.promoApplied
        $row["normalised_price_for_target"] = $store.normalisedPriceForTarget
        $row["normalised_target_size"] = $store.normalisedTargetSize
        $row["status"] = $store.status
        $row["message"] = $store.message
        $row["ingredients"] = $store.ingredients
        $row["quantity"] = $store.quantity
        $row["url"] = $store.url
        $row["last_matched_url"] = $store.lastMatchedUrl
        $row["last_seen_at"] = $store.lastSeenAt
        $rows += $row
    }
}

$csvFile = Join-Path $OutDir "products.csv"
@($rows | ForEach-Object { [pscustomobject]$_ }) | Export-Csv -LiteralPath $csvFile -NoTypeInformation -Encoding UTF8

$sheetDefs = @(
    @{ Name = "All Products"; Rows = $rows },
    @{ Name = "Pick n Pay"; Rows = @($rows | Where-Object { $_["store_id"] -eq "pick-n-pay" }) },
    @{ Name = "Woolworths"; Rows = @($rows | Where-Object { $_["store_id"] -eq "woolworths" }) },
    @{ Name = "Checkers"; Rows = @($rows | Where-Object { $_["store_id"] -eq "checkers" }) },
    @{ Name = "Spar"; Rows = @($rows | Where-Object { $_["store_id"] -eq "spar" }) },
    @{ Name = "Food Lovers"; Rows = @($rows | Where-Object { $_["store_id"] -eq "food-lovers" }) }
)

$temp = Join-Path ([IO.Path]::GetTempPath()) ("grocery-catalogue-xlsx-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $temp | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $temp "_rels") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $temp "xl") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $temp "xl\_rels") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $temp "xl\worksheets") | Out-Null

Set-Content -LiteralPath (Join-Path $temp "[Content_Types].xml") -Encoding UTF8 -Value @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet4.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet5.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet6.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>
'@

Set-Content -LiteralPath (Join-Path $temp "_rels\.rels") -Encoding UTF8 -Value @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>
'@

$workbook = New-Object System.Text.StringBuilder
[void]$workbook.AppendLine('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')
[void]$workbook.AppendLine('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>')
for ($i = 0; $i -lt $sheetDefs.Count; $i++) {
    $sheetId = $i + 1
    [void]$workbook.AppendLine("<sheet name=`"$(XmlEscape $sheetDefs[$i].Name)`" sheetId=`"$sheetId`" r:id=`"rId$sheetId`"/>")
}
[void]$workbook.AppendLine('</sheets></workbook>')
Set-Content -LiteralPath (Join-Path $temp "xl\workbook.xml") -Encoding UTF8 -Value $workbook.ToString()

$rels = New-Object System.Text.StringBuilder
[void]$rels.AppendLine('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')
[void]$rels.AppendLine('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">')
for ($i = 0; $i -lt $sheetDefs.Count; $i++) {
    $sheetId = $i + 1
    [void]$rels.AppendLine("<Relationship Id=`"rId$sheetId`" Type=`"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet`" Target=`"worksheets/sheet$sheetId.xml`"/>")
}
[void]$rels.AppendLine('</Relationships>')
Set-Content -LiteralPath (Join-Path $temp "xl\_rels\workbook.xml.rels") -Encoding UTF8 -Value $rels.ToString()

for ($i = 0; $i -lt $sheetDefs.Count; $i++) {
    $sheetId = $i + 1
    Set-Content -LiteralPath (Join-Path $temp "xl\worksheets\sheet$sheetId.xml") -Encoding UTF8 -Value (New-SheetXml $sheetDefs[$i].Rows $headers)
}

$zipFile = Join-Path $OutDir "grocery-catalogue.zip"
if (Test-Path -LiteralPath $OutFile) { Remove-Item -LiteralPath $OutFile -Force }
if (Test-Path -LiteralPath $zipFile) { Remove-Item -LiteralPath $zipFile -Force }
Compress-Archive -Path (Join-Path $temp "*") -DestinationPath $zipFile -Force
Move-Item -LiteralPath $zipFile -Destination $OutFile -Force
Remove-Item -LiteralPath $temp -Recurse -Force

Write-Host "Exported $OutFile"
Write-Host "Exported $csvFile"
