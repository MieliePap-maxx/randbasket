$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$WebDir = Join-Path $Root "web"
$DataDir = Join-Path $Root "data"
$ItemsFile = Join-Path $DataDir "items.json"
$SettingsFile = Join-Path $DataDir "settings.json"
$HistoryFile = Join-Path $DataDir "history.json"
$CatalogueFile = Join-Path $DataDir "catalogue.json"
$PopularSearchProfilesFile = Join-Path $DataDir "popular-search-profiles.json"
$ScanJobsFile = Join-Path $DataDir "scan-jobs.json"
$CatalogueRequestsFile = Join-Path $DataDir "catalogue-requests.json"
$HostName = "0.0.0.0"
$Port = 8765
$EdgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

$DefaultItems = @(
    @{ id = "milk-2l"; name = "Milk 2L"; query = "milk 2l"; quantity = 1; category = "Dairy" },
    @{ id = "eggs-18"; name = "Eggs 18 pack"; query = "eggs 18"; quantity = 1; category = "Staples" },
    @{ id = "bread"; name = "Brown bread"; query = "brown bread"; quantity = 1; category = "Bakery" },
    @{ id = "chicken"; name = "Chicken fillets 1kg"; query = "chicken fillets 1kg"; quantity = 1; category = "Meat" }
)

$DefaultSettings = @{
    location = "South Africa"
    maxResultsPerStore = 6
    preferredStore = "pick-n-pay"
    stores = @{
        "pick-n-pay" = $true
        checkers = $true
        woolworths = $true
    }
}

$Stores = @(
    [pscustomobject]@{ id = "pick-n-pay"; name = "Pick n Pay"; searchUrl = "https://www.pnp.co.za/search/{pathQuery}"; notes = "Online prices can depend on delivery area." },
    [pscustomobject]@{ id = "checkers"; name = "Checkers"; searchUrl = "https://www.checkers.co.za/search?query={query}"; notes = "Online prices can depend on delivery area." },
    [pscustomobject]@{ id = "woolworths"; name = "Woolworths"; searchUrl = "https://www.woolworths.co.za/cat?Ntt={query}"; notes = "Food results may vary by store and fulfilment method." }
)

$DirectProductLinks = @{
    checkers = @{
        "lean beef mince 1kg" = "https://www.checkers.co.za/product/lean-beef-mince-per-kg-10888491KG"
        "2l full cream milk" = "https://www.checkers.co.za/product/clover-fresh-full-cream-milk-2l-10136729EA"
        "full cream 2l milk" = "https://www.checkers.co.za/product/clover-fresh-full-cream-milk-2l-10136729EA"
    }
}

function ConvertTo-PlainObject($Value) {
    if ($null -eq $Value) { return $null }
    if ($Value -is [System.Collections.IDictionary]) {
        $out = @{}
        foreach ($key in $Value.Keys) { $out[$key] = ConvertTo-PlainObject $Value[$key] }
        return $out
    }
    if ($Value -is [pscustomobject]) {
        $out = @{}
        foreach ($prop in $Value.PSObject.Properties) { $out[$prop.Name] = ConvertTo-PlainObject $prop.Value }
        return $out
    }
    if ($Value -is [System.Collections.IEnumerable] -and $Value -isnot [string]) {
        $items = @()
        foreach ($item in $Value) { $items += ConvertTo-PlainObject $item }
        return ,$items
    }
    return $Value
}

function Write-JsonFile($Path, $Value) {
    $plain = ConvertTo-PlainObject $Value
    ConvertTo-Json -InputObject $plain -Depth 30 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Read-JsonFile($Path, $Fallback) {
    if (-not (Test-Path -LiteralPath $Path)) { return $Fallback }
    try {
        return Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
    } catch {
        return $Fallback
    }
}

function Ensure-Files {
    New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
    if (-not (Test-Path -LiteralPath $ItemsFile)) { Write-JsonFile $ItemsFile $DefaultItems }
    if (-not (Test-Path -LiteralPath $SettingsFile)) { Write-JsonFile $SettingsFile $DefaultSettings }
    if (-not (Test-Path -LiteralPath $HistoryFile)) { Write-JsonFile $HistoryFile @() }
    if (-not (Test-Path -LiteralPath $CatalogueFile)) { Write-JsonFile $CatalogueFile @() }
    if (-not (Test-Path -LiteralPath $ScanJobsFile)) { Write-JsonFile $ScanJobsFile @() }
    if (-not (Test-Path -LiteralPath $CatalogueRequestsFile)) { Write-JsonFile $CatalogueRequestsFile @() }
}

$script:CatalogueCache = @()
$script:CatalogueCacheStamp = -1L
$script:CatalogueSearchIndex = @()
$script:CatalogueTokenIndex = @{}
$script:PopularSearchProfilesCache = @()
$script:PopularSearchProfilesStamp = -1L

function Get-CatalogueSearchText($Product) {
    $haystack = @(
        $Product.canonicalName,
        $Product.category,
        $Product.targetSize,
        @($Product.searchTerms) -join " "
    )
    foreach ($storeProduct in @($Product.stores)) {
        $haystack += $storeProduct.productName
        $haystack += $storeProduct.brand
    }
    return (Clean-Text ($haystack -join " ")).ToLowerInvariant()
}

function Get-CatalogueSearchTokens([string]$Text) {
    $clean = (Clean-Text ([regex]::Replace($Text, "(?<=\d)(?=[a-zA-Z])", " "))).ToLowerInvariant()
    $tokens = [System.Collections.Generic.List[string]]::new()
    foreach ($match in [regex]::Matches($clean, "[a-z0-9]+")) {
        if ($match.Value.Length -gt 1) { $tokens.Add($match.Value) }
    }
    foreach ($match in [regex]::Matches($clean, "(?<![a-z0-9])(\d+(?:[\.,]\d+)?)\s*(kg|g|ml|l|litre|litres|liter|liters|pack|packs|pk|count|ct)(?![a-z])")) {
        $number = $match.Groups[1].Value.Replace(",", ".")
        $unit = $match.Groups[2].Value
        $unit = switch -Regex ($unit) {
            "^litre|^liter" { "l"; break }
            "^packs?$|^pk$" { "pack"; break }
            "^count$|^ct$" { "pack"; break }
            default { $unit }
        }
        $tokens.Add("measure:$number$unit")
    }
    return [string[]]@($tokens | Select-Object -Unique)
}

function Test-CatalogueSearchToken([string]$Text, [string]$Token) {
    if ($Token.StartsWith("measure:")) { return (Get-CatalogueSearchTokens $Text) -contains $Token }
    return $Text -match "(?<![a-z0-9])$([regex]::Escape($Token))(?![a-z0-9])"
}

function Get-Catalogue {
    $stamp = if (Test-Path -LiteralPath $CatalogueFile) { (Get-Item -LiteralPath $CatalogueFile).LastWriteTimeUtc.Ticks } else { 0L }
    if ($script:CatalogueCacheStamp -ne $stamp) {
        $script:CatalogueCache = [object[]](Read-JsonFile $CatalogueFile @())
        $index = [System.Collections.Generic.List[object]]::new()
        $tokenIndex = @{}
        foreach ($product in $script:CatalogueCache) {
            $entry = [pscustomobject]@{
                product = $product
                text = Get-CatalogueSearchText $product
                canonicalText = (Clean-Text $product.canonicalName).ToLowerInvariant()
            }
            $index.Add($entry)
            $tokens = @(Get-CatalogueSearchTokens $entry.text)
            foreach ($token in $tokens) {
                if (-not $tokenIndex.ContainsKey($token)) {
                    $tokenIndex[$token] = [System.Collections.Generic.List[object]]::new()
                }
                $tokenIndex[$token].Add($entry)
            }
        }
        $script:CatalogueSearchIndex = [object[]]$index.ToArray()
        $script:CatalogueTokenIndex = $tokenIndex
        $script:CatalogueCacheStamp = $stamp
    }
    return [object[]]$script:CatalogueCache
}

function Get-CatalogueScore($Query, $Product) {
    $queryText = (Clean-Text $Query).ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($queryText)) { return 1 }
    $haystack = @(
        $Product.canonicalName,
        $Product.category,
        $Product.targetSize,
        @($Product.searchTerms) -join " "
    )
    foreach ($storeProduct in @($Product.stores)) {
        $haystack += $storeProduct.productName
        $haystack += $storeProduct.brand
    }
    $text = (Clean-Text ($haystack -join " ")).ToLowerInvariant()
    if ($text.Contains($queryText)) { return 10 }
    $terms = @([regex]::Matches($queryText, "[a-z0-9]+") | ForEach-Object { $_.Value } | Where-Object { $_.Length -gt 1 } | Select-Object -Unique)
    if ($terms.Count -eq 0) { return 0 }
    $hits = 0
    foreach ($term in $terms) {
        if ($text.Contains($term)) { $hits += 1 }
    }
    if ($hits -eq 0) { return 0 }
    return [math]::Round($hits / [math]::Max($terms.Count, 1), 4)
}

function Get-PopularSearchProfiles {
    $stamp = if (Test-Path -LiteralPath $PopularSearchProfilesFile) { (Get-Item -LiteralPath $PopularSearchProfilesFile).LastWriteTimeUtc.Ticks } else { 0L }
    if ($script:PopularSearchProfilesStamp -ne $stamp) {
        $script:PopularSearchProfilesCache = if ($stamp -gt 0) { [object[]](Read-JsonFile $PopularSearchProfilesFile @()) } else { @() }
        $script:PopularSearchProfilesStamp = $stamp
    }
    return [object[]]$script:PopularSearchProfilesCache
}

function Test-SearchPhrase([string]$Text, [string]$Phrase) {
    if ([string]::IsNullOrWhiteSpace($Phrase)) { return $false }
    $cleanPhrase = (Clean-Text $Phrase).ToLowerInvariant()
    $suffix = if ($cleanPhrase -notmatch "\s") { "s?" } else { "" }
    $pattern = "(?<![a-z0-9])$([regex]::Escape($cleanPhrase))$suffix(?![a-z0-9])"
    return $Text -match $pattern
}

function Get-GrocerySearchAdjustment([string]$QueryText, [string]$ProductText, [string]$Category, $Profiles) {
    $profiles = @($Profiles)
    if ($profiles.Count -eq 0) { return 0.0 }

    $longestTerm = ($profiles | ForEach-Object { (Clean-Text ([string]$_.term)).Length } | Measure-Object -Maximum).Maximum
    $adjustment = 0.0
    foreach ($profile in $profiles) {
        if ((Clean-Text ([string]$profile.term)).Length -ne $longestTerm) { continue }
        if ($Category -eq [string]$profile.category) { $adjustment += 1.5 }
        else { $adjustment -= 0.35 }
        foreach ($excludedTerm in @($profile.exclude)) {
            if (-not (Test-SearchPhrase $QueryText ([string]$excludedTerm)) -and (Test-SearchPhrase $ProductText ([string]$excludedTerm))) {
                $adjustment -= 3.0
            }
        }
        foreach ($preferredTerm in @($profile.prefer)) {
            if (Test-SearchPhrase $ProductText ([string]$preferredTerm)) {
                $adjustment += 2.0
            }
        }
    }
    return $adjustment
}

function Search-Catalogue($Query, $Limit = 25, $Offset = 0) {
    $catalogue = Get-Catalogue
    $queryText = (Clean-Text ([regex]::Replace($Query, "(?<=\d)(?=[a-zA-Z])", " "))).ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($queryText)) {
        return [object[]]@()
    }
    $matchingProfiles = @(Get-PopularSearchProfiles | Where-Object { Test-SearchPhrase $queryText ([string]$_.term) })
    $lookupText = $queryText
    $aliasProfile = $matchingProfiles | Sort-Object @{ Expression = { (Clean-Text ([string]$_.term)).Length }; Descending = $true } | Where-Object { $_.searchText } | Select-Object -First 1
    if ($aliasProfile) {
        $lookupText = (Clean-Text ([string]$aliasProfile.searchText)).ToLowerInvariant()
    }
    $terms = @(Get-CatalogueSearchTokens $lookupText)
    if ($terms.Count -eq 0) { return [object[]]@() }
    $candidateMap = @{}
    $candidateHits = @{}
    $indexedTerms = @($terms | Where-Object { $script:CatalogueTokenIndex.ContainsKey($_) })
    foreach ($term in $indexedTerms) {
        foreach ($entry in @($script:CatalogueTokenIndex[$term])) {
            $candidateMap[$entry.product.id] = $entry
            $currentHits = if ($candidateHits.ContainsKey($entry.product.id)) { [int]$candidateHits[$entry.product.id] } else { 0 }
            $candidateHits[$entry.product.id] = $currentHits + 1
        }
    }
    # Search terms rank products; they are not a brittle all-or-nothing filter.
    # Keep close titles available when one retailer formats a pack size or a
    # descriptive word differently from the shopper's phrasing.
    $indexedCoreTerms = @($indexedTerms | Where-Object { -not $_.StartsWith("measure:") })
    $minimumCoreHits = [math]::Max(1, $indexedCoreTerms.Count - 1)
    if ($indexedCoreTerms.Count -gt 1) {
        foreach ($id in @($candidateMap.Keys)) {
            $entry = $candidateMap[$id]
            $coreHits = 0
            foreach ($term in $indexedCoreTerms) {
                if (Test-CatalogueSearchToken ([string]$entry.text) $term) { $coreHits += 1 }
            }
            if ($coreHits -lt $minimumCoreHits) { $candidateMap.Remove($id) }
        }
    }
    $results = [System.Collections.Generic.List[object]]::new()
    foreach ($entry in $candidateMap.Values) {
        $product = $entry.product
        $text = [string]$entry.text
        $canonicalText = [string]$entry.canonicalText
        $hits = 0
        $canonicalHits = 0
        foreach ($term in $terms) {
            if (Test-CatalogueSearchToken $text $term) { $hits += 1 }
            if (Test-CatalogueSearchToken $canonicalText $term) { $canonicalHits += 1 }
        }
        $score = ($hits / [math]::Max($terms.Count, 1)) + ($canonicalHits / [math]::Max($terms.Count, 1))
        if ($canonicalText -eq $lookupText) { $score += 4 }
        elseif ($canonicalText.StartsWith($lookupText)) { $score += 2 }
        elseif ($canonicalText.Contains($lookupText)) { $score += 1 }
        if ($canonicalHits -eq $terms.Count) {
            $score += Get-GrocerySearchAdjustment $queryText $canonicalText ([string]$product.category) $matchingProfiles
        }
        if ($score -le 0) { continue }
        $match = [pscustomobject]@{
            id = $product.id
            canonicalName = $product.canonicalName
            category = $product.category
            targetSize = $product.targetSize
            searchTerms = [object[]]@($product.searchTerms)
            stores = [object[]]@($product.stores)
            score = $score
            pricedStoreCount = @($product.stores | Where-Object { $null -ne $_.price }).Count
            imageStoreCount = @($product.stores | Where-Object { $_.imageUrl }).Count
        }
        [void]$results.Add($match)
    }
    $ordered = @($results.ToArray() | Sort-Object `
        @{ Expression = { -([double]$_.score) } }, `
        @{ Expression = { -([int]$_.pricedStoreCount) } }, `
        @{ Expression = { -([int]$_.imageStoreCount) } }, `
        canonicalName)
    $featured = [System.Collections.Generic.List[object]]::new()
    $featuredIds = @{}
    foreach ($storeId in @("pick-n-pay", "checkers", "woolworths")) {
        $retailerMatch = $ordered | Where-Object { @($_.stores | Where-Object { $_.storeId -eq $storeId -and $null -ne $_.price }).Count -gt 0 } | Select-Object -First 1
        if ($retailerMatch -and -not $featuredIds.ContainsKey($retailerMatch.id)) {
            $featured.Add($retailerMatch)
            $featuredIds[$retailerMatch.id] = $true
        }
    }
    $balanced = @($featured.ToArray()) + @($ordered | Where-Object { -not $featuredIds.ContainsKey($_.id) })
    return [object[]]($balanced | Select-Object -Skip ([math]::Max(0, $Offset)) -First $Limit)
}

function Get-RetailerCategoryHint($StoreMatch, $FallbackCategory) {
    $rawUrl = ([string]$StoreMatch.url).ToLowerInvariant()
    # Woolworths and similar feeds place the product name after /_/ in the URL.
    # Classify the breadcrumb before that point, so "Yoghurt Coated Rice Cakes"
    # remains a snack rather than being mistaken for the Yoghurt aisle.
    $breadcrumbUrl = ($rawUrl -split "/_/", 2)[0]
    $text = (Clean-Text ((@($StoreMatch.productName, $breadcrumbUrl, $FallbackCategory) -join " ") -replace "[-_/]", " ")).ToLowerInvariant()
    # An explicit retailer breadcrumb must beat a category copied from another
    # retailer when the catalogue consolidated two similarly named products.
    if ($breadcrumbUrl -match "chocolates-sweets-snacks|/biscuits(?:/|$)|rice-corn-cakes|/snacks(?:/|$)") { return "Snacks" }
    if ($breadcrumbUrl -match "ready-meals|prepared-food|/meals(?:/|$)") { return "Ready Meals" }
    if ($breadcrumbUrl -match "milk-dairy-eggs|/dairy(?:/|$)|/yoghurt(?:/|$)") { return "Dairy" }
    if ($breadcrumbUrl -match "bakery|/bread(?:/|$)|/rolls(?:/|$)|/bagels(?:/|$)") { return "Bakery" }
    if ($breadcrumbUrl -match "fruit-vegetables|fresh-produce|/produce(?:/|$)") { return "Fruit & Vegetables" }
    if ($breadcrumbUrl -match "meat|poultry|beef|lamb|pork|seafood|/fish(?:/|$)") { return "Meat" }
    if ($breadcrumbUrl -match "frozen") { return "Frozen" }
    if ($breadcrumbUrl -match "baby") { return "Baby" }
    if ($breadcrumbUrl -match "pet") { return "Pets" }
    if ($breadcrumbUrl -match "toiletries|personal-care|oral-care|hair-care|body-care") { return "Personal Care" }
    if ($breadcrumbUrl -match "household|cleaning|laundry") { return "Cleaning & Household" }
    if ($breadcrumbUrl -match "beverages|drinks|/water(?:/|$)|coffee|tea|juice") { return "Beverages" }
    if ($breadcrumbUrl -match "pantry|groceries|cooking|tinned|canned") { return "Pantry" }
    if ($text -match "\bdairy\b") { return "Dairy" }
    if ($text -match "meat|poultry|beef|lamb|pork|seafood|fish") { return "Meat" }
    if ($text -match "fruit vegetables|fresh produce|\bproduce\b") { return "Fruit & Vegetables" }
    if ($text -match "bakery|bread|rolls|bagels") { return "Bakery" }
    if ($text -match "frozen") { return "Frozen" }
    if ($text -match "baby") { return "Baby" }
    if ($text -match "pet") { return "Pets" }
    if ($text -match "toiletries|personal care|oral care|hair care|body care") { return "Personal Care" }
    if ($text -match "household|cleaning|laundry") { return "Cleaning & Household" }
    if ($text -match "beverages|drinks|water|coffee|tea|juice") { return "Beverages" }
    if ($text -match "pantry|groceries|cooking|tinned|canned") { return "Pantry" }
    return [string]$FallbackCategory
}

function Get-RetailerCatalogueScore([string]$QueryText, [string]$LookupText, $Terms, $StoreMatch, [string]$FallbackCategory, $Profiles) {
    $nameText = (Clean-Text ([regex]::Replace((@($StoreMatch.productName, $StoreMatch.brand) -join " "), "(?<=\d)(?=[a-zA-Z])", " "))).ToLowerInvariant()
    $urlText = (Clean-Text (([string]$StoreMatch.url -replace "[-_/]", " "))).ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($nameText)) { return -999.0 }
    $hits = 0
    foreach ($term in @($Terms)) {
        if (Test-CatalogueSearchToken $nameText $term) { $hits += 1 }
    }
    $coreTerms = @($Terms | Where-Object { -not $_.StartsWith("measure:") })
    $measurementTerms = @($Terms | Where-Object { $_.StartsWith("measure:") })
    $coreHits = 0
    foreach ($term in $coreTerms) {
        if (Test-CatalogueSearchToken $nameText $term) { $coreHits += 1 }
    }
    $minimumCoreHits = [math]::Max(1, $coreTerms.Count - 1)
    if ($coreHits -lt $minimumCoreHits) { return -999.0 }

    # The product title is the authority. URL taxonomy is only used to separate
    # a grocery product from a snack/recipe which happens to contain the same word.
    $score = 8.0 + (2.0 * $coreHits)
    foreach ($term in $measurementTerms) {
        if (Test-CatalogueSearchToken $nameText $term) { $score += 4.0 }
    }
    if ($nameText -eq $LookupText) { $score += 8.0 }
    elseif ($nameText.Contains($LookupText)) { $score += 4.0 }
    if ($urlText.Contains($LookupText)) { $score += 1.0 }

    $categoryHint = Get-RetailerCategoryHint $StoreMatch $FallbackCategory
    $profiles = @($Profiles)
    if ($profiles.Count -gt 0) {
        $longestTerm = ($profiles | ForEach-Object { (Clean-Text ([string]$_.term)).Length } | Measure-Object -Maximum).Maximum
        foreach ($profile in $profiles) {
            if ((Clean-Text ([string]$profile.term)).Length -ne $longestTerm) { continue }
            if ($categoryHint -eq [string]$profile.category) { $score += 3.0 }
            elseif ($categoryHint) { $score -= 0.75 }
            foreach ($excludedTerm in @($profile.exclude)) {
                if (-not (Test-SearchPhrase $QueryText ([string]$excludedTerm)) -and (Test-SearchPhrase $nameText ([string]$excludedTerm))) {
                    $score -= 2.5
                }
            }
            foreach ($preferredTerm in @($profile.prefer)) {
                if (Test-SearchPhrase $nameText ([string]$preferredTerm)) { $score += 2.0 }
            }
        }
    }
    return $score
}

function Get-CatalogueRetailerMatches($Query, $PerStore = 3) {
    $queryText = (Clean-Text ([regex]::Replace($Query, "(?<=\d)(?=[a-zA-Z])", " "))).ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($queryText)) { return [object[]]@() }
    $matchingProfiles = @(Get-PopularSearchProfiles | Where-Object { Test-SearchPhrase $queryText ([string]$_.term) })
    $lookupText = $queryText
    $aliasProfile = $matchingProfiles | Sort-Object @{ Expression = { (Clean-Text ([string]$_.term)).Length }; Descending = $true } | Where-Object { $_.searchText } | Select-Object -First 1
    if ($aliasProfile) { $lookupText = (Clean-Text ([string]$aliasProfile.searchText)).ToLowerInvariant() }
    $terms = @(Get-CatalogueSearchTokens $lookupText)
    if ($terms.Count -eq 0) { return [object[]]@() }

    $candidates = @(Search-Catalogue $Query 10000 0)
    $matches = [System.Collections.Generic.List[object]]::new()
    foreach ($storeId in @("pick-n-pay", "checkers", "woolworths")) {
        $storeCandidates = [System.Collections.Generic.List[object]]::new()
        foreach ($product in $candidates) {
            foreach ($storeMatch in @($product.stores | Where-Object { $_.storeId -eq $storeId -and $null -ne $_.price })) {
                $score = Get-RetailerCatalogueScore $queryText $lookupText $terms $storeMatch ([string]$product.category) $matchingProfiles
                if ($score -gt -100) {
                    $storeCandidates.Add([pscustomobject]@{
                        id = $product.id
                        canonicalName = $product.canonicalName
                        category = $(if ($product.category) { $product.category } else { Get-RetailerCategoryHint $storeMatch "" })
                        targetSize = $product.targetSize
                        searchTerms = [object[]]@($product.searchTerms)
                        stores = [object[]]@($storeMatch)
                        score = $score
                    })
                }
            }
        }
        $seenStoreProducts = @{}
        foreach ($candidate in @($storeCandidates.ToArray() | Sort-Object @{ Expression = { -([double]$_.score) } }, canonicalName)) {
            $storeMatch = $candidate.stores[0]
            $key = (Clean-Text ([string]$storeMatch.productName)).ToLowerInvariant()
            if ($seenStoreProducts.ContainsKey($key)) { continue }
            $seenStoreProducts[$key] = $true
            [void]$matches.Add($candidate)
            if ($seenStoreProducts.Count -ge $PerStore) { break }
        }
    }
    return [object[]]$matches.ToArray()
}

function Get-CatalogueCategories {
    $catalogue = Get-Catalogue
    $groups = @($catalogue | Group-Object { if ($_.category) { $_.category } else { "Other" } } | Sort-Object Name)
    $categories = [System.Collections.Generic.List[object]]::new()
    foreach ($group in $groups) {
        # The phone only displays eight browse suggestions per section. Keep the
        # full count, but do not send the complete national catalogue over Wi-Fi.
        $products = @($group.Group | Sort-Object canonicalName | Select-Object -First 8 | ForEach-Object {
            [pscustomobject]@{
                id = $_.id
                canonicalName = $_.canonicalName
                category = $_.category
                targetSize = $_.targetSize
                searchTerms = [object[]]@($_.searchTerms)
                stores = [object[]]@($_.stores)
                score = 1
            }
        })
        $categories.Add([pscustomobject]@{
            name = $group.Name
            count = $group.Count
            products = [object[]]$products
        })
    }
    return [object[]]$categories.ToArray()
}

function Get-LanUrl {
    try {
        $addresses = @([System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) | Where-Object {
            $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and
            -not $_.IPAddressToString.StartsWith("127.") -and
            -not $_.IPAddressToString.StartsWith("169.254.")
        })
        if ($addresses.Count -gt 0) { return "http://$($addresses[0].IPAddressToString):$Port" }
    } catch {}
    return "http://127.0.0.1:$Port"
}

function Normalize-ItemLinks($Links) {
    $out = [ordered]@{}
    foreach ($store in $Stores) {
        $value = ""
        if ($Links -and $Links.PSObject.Properties.Name -contains $store.id) {
            $value = Clean-Text $Links.($store.id)
        }
        $out[$store.id] = $(if ($value -match "^https?://") { $value } else { "" })
    }
    return [pscustomobject]$out
}

function Parse-Measure($Text) {
    $value = [string]$Text
    if ([string]::IsNullOrWhiteSpace($value)) { return $null }
    $lower = $value.ToLowerInvariant()
    $matches = @([regex]::Matches($lower, "([0-9]+(?:[\.,][0-9]+)?)[\s-]*(kg|g|l|ml|pack|pk|ct|count|s)\b"))
    if ($matches.Count -eq 0) {
        $matches = @([regex]::Matches($lower, "\bx\s*([0-9]+)\b|\b([0-9]+)\s*x\b"))
    }
    if ($matches.Count -eq 0) { return $null }

    $best = $matches[$matches.Count - 1]
    $amountText = $(if ($best.Groups[1].Success) { $best.Groups[1].Value } else { $best.Groups[2].Value })
    $unit = $(if ($best.Groups.Count -gt 2 -and $best.Groups[2].Success -and $best.Groups[2].Value) { $best.Groups[2].Value } else { "ea" })
    $amount = [double]($amountText.Replace(",", "."))

    switch ($unit) {
        "kg" { return [pscustomobject]@{ amount = $amount * 1000; unit = "g"; label = "$amount kg" } }
        "g" { return [pscustomobject]@{ amount = $amount; unit = "g"; label = "$amount g" } }
        "l" { return [pscustomobject]@{ amount = $amount * 1000; unit = "ml"; label = "$amount L" } }
        "ml" { return [pscustomobject]@{ amount = $amount; unit = "ml"; label = "$amount ml" } }
        default { return [pscustomobject]@{ amount = $amount; unit = "ea"; label = "$amount ea" } }
    }
}

function Get-TargetMeasure($Item) {
    if ($Item.PSObject.Properties.Name -contains "targetSize" -and $Item.targetSize) {
        $measure = Parse-Measure $Item.targetSize
        if ($measure) { return $measure }
    }
    $measure = Parse-Measure $Item.query
    if ($measure) { return $measure }
    $measure = Parse-Measure $Item.name
    if ($measure) { return $measure }
    if ($Item.PSObject.Properties.Name -contains "links" -and $Item.links) {
        foreach ($store in $Stores) {
            if ($Item.links.PSObject.Properties.Name -contains $store.id -and $Item.links.($store.id)) {
                $measure = Parse-Measure (Get-MeasureSafeUrlText $Item.links.($store.id))
                if ($measure) { return $measure }
            }
        }
    }
    return $null
}

function Get-MeasureSafeUrlText($Url) {
    if ([string]::IsNullOrWhiteSpace([string]$Url)) { return "" }
    $text = [Uri]::UnescapeDataString([string]$Url)
    try {
        $uri = [Uri]$text
        $text = $uri.AbsolutePath
    } catch {}
    $text = $text -replace "(?i)\b\d{5,}(?:_)?(?:EA|KG|KGM)?\b", " "
    $text = $text -replace "(?i)/p/\d+[_a-z]*", " "
    $text = $text -replace "[-_/]+", " "
    return $text
}

function Get-ProductMeasure($Name, $Url, $Query) {
    $measure = Parse-Measure $Name
    if ($measure) { return $measure }
    $measure = Parse-Measure $Query
    if ($measure) { return $measure }
    $measure = Parse-Measure (Get-MeasureSafeUrlText $Url)
    if ($measure) { return $measure }
    return $null
}

function Get-NormalizedLinePrice($ShelfPrice, $ProductMeasure, $TargetMeasure, $Quantity) {
    $qty = [double]$Quantity
    if ($qty -le 0) { $qty = 1 }
    $price = [double]$ShelfPrice
    if ($ProductMeasure -and $TargetMeasure -and $ProductMeasure.unit -eq $TargetMeasure.unit -and [double]$ProductMeasure.amount -gt 0) {
        $ratio = [double]$TargetMeasure.amount / [double]$ProductMeasure.amount
        return [math]::Round($price * $ratio * $qty, 2)
    }
    return [math]::Round($price * $qty, 2)
}

function Clean-Text($Value) {
    if ($null -eq $Value) { return "" }
    $text = [System.Net.WebUtility]::HtmlDecode([string]$Value)
    $text = $text -replace "<[^>]+>", " "
    $text = $text -replace "\s+", " "
    if ($text.Length -gt 180) { return $text.Trim().Substring(0, 180) }
    return $text.Trim()
}

function Clean-PageText($Value) {
    if ($null -eq $Value) { return "" }
    $text = [System.Net.WebUtility]::HtmlDecode([string]$Value)
    $text = $text -replace "<[^>]+>", " "
    $text = $text -replace "\s+", " "
    return $text.Trim()
}

function Get-Money($Value) {
    if ($null -eq $Value) { return $null }
    if ($Value -is [int] -or $Value -is [double] -or $Value -is [decimal]) {
        $amount = [double]$Value
        if ($amount -gt 10000) { return [math]::Round($amount / 100, 2) }
        return [math]::Round($amount, 2)
    }
    $text = [System.Net.WebUtility]::HtmlDecode([string]$Value).Replace(",", ".")
    if ($text -notmatch "(R|ZAR|rand|rands)" -and $text -notmatch "^\s*[0-9]+(?:\.[0-9]{1,2})?\s*$") { return $null }
    $match = [regex]::Match($text, "(?:R|ZAR)?\s*([0-9]+(?:\.[0-9]{1,2})?)", "IgnoreCase")
    if (-not $match.Success) { return $null }
    return [math]::Round([double]$match.Groups[1].Value, 2)
}

function Get-Similarity($Query, $Name) {
    $qWords = [regex]::Matches(([string]$Query).ToLowerInvariant(), "[a-z0-9]+") | ForEach-Object { $_.Value } | Where-Object { $_.Length -gt 1 } | Select-Object -Unique
    $nWords = [regex]::Matches(([string]$Name).ToLowerInvariant(), "[a-z0-9]+") | ForEach-Object { $_.Value } | Where-Object { $_.Length -gt 1 } | Select-Object -Unique
    if ($qWords.Count -eq 0 -or $nWords.Count -eq 0) { return 0 }
    $overlap = 0
    foreach ($word in $qWords) { if ($nWords -contains $word) { $overlap += 1 } }
    return $overlap / [math]::Max($qWords.Count, 1)
}

function Normalize-ProductPhrase($Value) {
    $text = (Clean-Text $Value).ToLowerInvariant()
    $text = $text -replace "\b([0-9]+)\s*(kilogram|kilograms|kgs)\b", '$1kg'
    $text = $text -replace "\b([0-9]+)\s*(gram|grams|gr)\b", '$1g'
    $text = $text -replace "\b([0-9]+)\s*(litre|litres|ltr|lt)\b", '$1l'
    $text = $text -replace "\b([0-9]+)\s*(millilitre|millilitres)\b", '$1ml'
    $text = $text -replace "\b([0-9]+)\s*(kg|g|l|ml)\b", '$1$2'
    $text = $text -replace "\b([0-9]+)\s*(pack|pk|ct|count|s)\b", '$1'
    $text = $text -replace "\bx\s*([0-9]+)\b", '$1'
    $text = $text -replace "\b([0-9]+)\s*x\b", '$1'
    $text = $text -replace "\bminced\b", "mince"
    $text = $text -replace "\beggs\b", "egg"
    $text = $text -replace "\bfillets\b", "fillet"
    $text = $text -replace "\s+", " "
    return $text.Trim()
}

function Get-ProductTerms($Value) {
    $stopWords = @(
        "and", "the", "with", "for", "from", "fresh", "value", "pack", "packs",
        "each", "per", "only", "save", "pnp", "pick", "pay", "woolworths",
        "checkers", "shoprite", "food", "lover", "lovers", "market", "range"
    )
    $terms = @()
    foreach ($match in [regex]::Matches((Normalize-ProductPhrase $Value), "[a-z0-9]+")) {
        $word = $match.Value
        if ($word.Length -le 1) { continue }
        if ($stopWords -contains $word) { continue }
        if ($word.EndsWith("s") -and $word -notmatch "^[0-9]+s$" -and $word.Length -gt 3) {
            $word = $word.Substring(0, $word.Length - 1)
        }
        $terms += $word
    }
    return @($terms | Select-Object -Unique)
}

function Get-SizeTerms($Terms) {
    return @($Terms | Where-Object { $_ -match "^[0-9]+(?:kg|g|l|ml)?$" })
}

function Get-SpecificTerms($Terms) {
    $generic = @(
        "cheese", "milk", "egg", "beef", "mince", "chicken", "fillet",
        "bread", "loaf", "large", "extra", "fresh", "cream"
    )
    return @($Terms | Where-Object { $_ -notmatch "^[0-9]+(?:kg|g|l|ml)?$" -and $generic -notcontains $_ })
}

function Get-QueryVariants($Query) {
    $clean = Normalize-ProductPhrase $Query
    $terms = @(Get-ProductTerms $clean)
    $sizes = @(Get-SizeTerms $terms)
    $core = @($terms | Where-Object { $sizes -notcontains $_ })
    $variants = @((Clean-Text $Query), $clean)
    if ($core.Count -gt 0 -and $sizes.Count -gt 0) {
        $variants += (($core + $sizes) -join " ")
        $variants += (($sizes + $core) -join " ")
        $variants += ($core -join " ")
    } elseif ($core.Count -gt 0) {
        $variants += ($core -join " ")
    }
    $withoutJoiners = ($clean -replace "\bx\b", " " -replace "\s+", " ").Trim()
    if ($withoutJoiners) { $variants += $withoutJoiners }
    $withoutSize = ($withoutJoiners -replace "\b\d+\s*(kg|g|l|ml|s|pack)?\b", " " -replace "\s+", " ").Trim()
    if ($withoutSize) { $variants += $withoutSize }
    return @($variants | Where-Object { $_ } | Select-Object -Unique)
}

function Get-DirectProductLink($StoreId, $Query) {
    $links = $null
    foreach ($storeKey in $DirectProductLinks.Keys) {
        if (([string]$storeKey).ToLowerInvariant() -eq ([string]$StoreId).ToLowerInvariant()) {
            $links = $DirectProductLinks[$storeKey]
            break
        }
    }
    if ($null -eq $links) { return $null }
    foreach ($variant in Get-QueryVariants $Query) {
        $key = Normalize-ProductPhrase $variant
        foreach ($linkKey in $links.Keys) {
            if ((Normalize-ProductPhrase $linkKey) -eq $key) { return $links[$linkKey] }
        }
    }
    return $null
}

function Get-ItemProductLink($StoreId, $Item, $Query) {
    foreach ($propName in @("links", "productLinks", "urls")) {
        if ($Item.PSObject.Properties.Name -contains $propName) {
            $links = $Item.$propName
            if ($links -and $links.PSObject.Properties.Name -contains $StoreId) {
                $url = Clean-Text $links.$StoreId
                if ($url -match "^https?://") { return $url }
            }
        }
    }
    return Get-DirectProductLink $StoreId $Query
}

function Get-ProductScore($Query, $Name) {
    $qWords = @(Get-ProductTerms $Query)
    $nWords = @(Get-ProductTerms $Name)
    if ($qWords.Count -eq 0 -or $nWords.Count -eq 0) { return 0 }
    $overlap = 0
    foreach ($word in $qWords) { if ($nWords -contains $word) { $overlap += 1 } }
    $score = $overlap / [math]::Max($qWords.Count, 1)
    $coreWords = @($qWords | Where-Object { $_ -notmatch "^[0-9]+(?:kg|g|l|ml)?$" })
    $coreHits = 0
    foreach ($word in $coreWords) { if ($nWords -contains $word) { $coreHits += 1 } }
    if ($coreWords.Count -gt 0 -and $coreHits -eq 0) { return 0 }
    $specificWords = @(Get-SpecificTerms $qWords)
    if ($specificWords.Count -gt 0) {
        $specificHits = 0
        foreach ($word in $specificWords) { if ($nWords -contains $word) { $specificHits += 1 } }
        if ($specificHits -eq 0) { return 0 }
        $score += 0.12 * ($specificHits / [math]::Max($specificWords.Count, 1))
    }
    $qSizes = @(Get-SizeTerms $qWords)
    if ($qSizes.Count -gt 0) {
        $sizeHits = 0
        foreach ($size in $qSizes) { if ($nWords -contains $size) { $sizeHits += 1 } }
        if ($sizeHits -gt 0) { $score += 0.2 } else { $score -= 0.12 }
    }
    return [math]::Round($score, 4)
}

function Test-ProductText($Text) {
    if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
    $line = Clean-Text $Text
    if ($line.Length -lt 4 -or $line.Length -gt 140) { return $false }
    if ($line -match "^(add to cart|currently out of stock|save|smart shopper|sponsored|sort by|best match|results for|search results for|you searched for|brand|price|unit of measure|on promotion|certifications|halaal|kosher|vegetarian|home|all|food|help|company|copyright|search|filter by)") { return $false }
    if ($line -match "delivery|checkout|cookie|privacy|terms|slot|suburb|address|sign in|register|cart|favourites|shopping list|customer support") { return $false }
    if (Test-JunkProductName $line) { return $false }
    return $true
}

function Fetch-Page($Url) {
    $headers = @{
        "User-Agent" = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
        "Accept" = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        "Accept-Language" = "en-ZA,en;q=0.9"
        "Cache-Control" = "no-cache"
        "Pragma" = "no-cache"
    }
    $response = Invoke-WebRequest -Uri $Url -Headers $headers -UseBasicParsing -TimeoutSec 25
    return $response.Content
}

function Get-FreeTcpPort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $port = $listener.LocalEndpoint.Port
    $listener.Stop()
    return $port
}

function Send-CdpCommand($Socket, $Id, $Method, $Params = $null) {
    $payload = @{ id = $Id; method = $Method }
    if ($null -ne $Params) { $payload.params = $Params }
    $json = ConvertTo-Json -InputObject $payload -Depth 12 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $Socket.SendAsync(
        [ArraySegment[byte]]::new($bytes),
        [System.Net.WebSockets.WebSocketMessageType]::Text,
        $true,
        [Threading.CancellationToken]::None
    ).Wait()

    $message = ""
    while ($true) {
        $buffer = New-Object byte[] 4194304
        $result = $Socket.ReceiveAsync([ArraySegment[byte]]::new($buffer), [Threading.CancellationToken]::None).Result
        $message += [Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count)
        if (-not $result.EndOfMessage) { continue }
        try {
            $parsed = $message | ConvertFrom-Json
            if ($parsed.PSObject.Properties.Name -contains "id" -and [int]$parsed.id -eq [int]$Id) {
                return $parsed
            }
        } catch {}
        $message = ""
    }
}

function Invoke-RenderedPage($Url, $WaitMs = 26000) {
    if (-not (Test-Path -LiteralPath $EdgePath)) { return $null }
    New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
    $profile = Join-Path $DataDir ("edge-profile-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Force -Path $profile | Out-Null
    $port = Get-FreeTcpPort
    $process = $null
    $socket = $null
    try {
        $edgeArgs = '--disable-gpu --no-first-run --disable-extensions --remote-debugging-port=' + $port + ' --user-data-dir="' + $profile + '" about:blank'
        $process = Start-Process -FilePath $EdgePath -ArgumentList $edgeArgs -PassThru -WindowStyle Hidden

        $versionUrl = "http://127.0.0.1:$port/json/version"
        $ready = $false
        for ($i = 0; $i -lt 25; $i++) {
            try {
                Invoke-WebRequest -UseBasicParsing -Uri $versionUrl -TimeoutSec 2 | Out-Null
                $ready = $true
                break
            } catch {
                Start-Sleep -Milliseconds 250
            }
        }
        if (-not $ready) { return $null }

        $newTabUrl = "http://127.0.0.1:$port/json/new?$Url"
        $newTab = Invoke-WebRequest -UseBasicParsing -Uri $newTabUrl -Method Put -TimeoutSec 10
        $tab = $newTab.Content | ConvertFrom-Json
        $socket = [System.Net.WebSockets.ClientWebSocket]::new()
        $socket.ConnectAsync([Uri]$tab.webSocketDebuggerUrl, [Threading.CancellationToken]::None).Wait()
        Send-CdpCommand $socket 1 "Page.enable" | Out-Null
        Send-CdpCommand $socket 2 "Runtime.enable" | Out-Null

        $deadline = (Get-Date).AddMilliseconds([double]$WaitMs)
        $probeExpression = 'JSON.stringify({ready:document.readyState,title:document.title,text:(document.body&&document.body.innerText||""),hasPrice:/R\s*[0-9]/.test(document.body&&document.body.innerText||"")})'
        $lastProbe = $null
        while ((Get-Date) -lt $deadline) {
            Start-Sleep -Milliseconds 900
            $probe = Send-CdpCommand $socket 3 "Runtime.evaluate" @{ expression = $probeExpression; returnByValue = $true; awaitPromise = $true }
            try { $lastProbe = $probe.result.result.value | ConvertFrom-Json } catch { $lastProbe = $null }
            if ($lastProbe -and $lastProbe.ready -eq "complete" -and [string]$lastProbe.text -and [string]$lastProbe.text.Length -gt 80) {
                if ($lastProbe.hasPrice -or $lastProbe.title -match "PnP|Pick n Pay|Woolworths|Checkers") { break }
            }
        }

        $htmlResponse = Send-CdpCommand $socket 4 "Runtime.evaluate" @{
            expression = 'document.documentElement ? document.documentElement.outerHTML : ""'
            returnByValue = $true
            awaitPromise = $true
        }
        $html = [string]$htmlResponse.result.result.value
        if ($env:GPC_INCLUDE_RESOURCE_URLS -eq "1") {
            $resourceResponse = Send-CdpCommand $socket 5 "Runtime.evaluate" @{
                expression = 'JSON.stringify(performance.getEntriesByType("resource").map(function(entry){return entry.name;}))'
                returnByValue = $true
                awaitPromise = $true
            }
            try {
                $resourceJson = [string]$resourceResponse.result.result.value
                $resources = [object[]]($resourceJson | ConvertFrom-Json)
                $resourceLines = foreach ($resource in $resources) { [System.Net.WebUtility]::HtmlEncode([string]$resource) }
                $html += "`n<!-- GPC_RESOURCE_URLS`n" + ($resourceLines -join "`n") + "`n-->"
            } catch {}
        }
        if (-not $html -and $lastProbe -and $lastProbe.text) {
            return "<html><body><pre>" + [System.Net.WebUtility]::HtmlEncode([string]$lastProbe.text) + "</pre></body></html>"
        }
        return $html
    } finally {
        if ($socket) { try { $socket.Dispose() } catch {} }
        if ($process) { try { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue } catch {} }
        try { Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue } catch {}
    }
}

function Walk-Json($Value) {
    $found = @()
    if ($null -eq $Value) { return $found }

    if ($Value -is [pscustomobject]) {
        $name = $Value.name
        if (-not $name) { $name = $Value.title }
        if (-not $name) { $name = $Value.displayName }
        if (-not $name) { $name = $Value.productName }

        $price = $Value.price
        if (-not $price) { $price = $Value.sellingPrice }
        if (-not $price) { $price = $Value.currentPrice }
        if (-not $price) { $price = $Value.displayPrice }
        if (-not $price -and $Value.offers) {
            $offers = @($Value.offers)
            foreach ($offer in $offers) {
                if ($offer.price) { $price = $offer.price; break }
                if ($offer.lowPrice) { $price = $offer.lowPrice; break }
                if ($offer.highPrice) { $price = $offer.highPrice; break }
            }
        }
        if ($price -is [pscustomobject]) {
            if ($price.value) { $price = $price.value }
            elseif ($price.amount) { $price = $price.amount }
            elseif ($price.formattedValue) { $price = $price.formattedValue }
        }
        $amount = Get-Money $price
        if ($name -and $amount) {
            $url = $Value.url
            if (-not $url) { $url = $Value.pdpUrl }
            if (-not $url) { $url = $Value.productUrl }
            $found += [pscustomobject]@{ name = Clean-Text $name; price = $amount; url = $url }
        }
        foreach ($prop in $Value.PSObject.Properties) { $found += Walk-Json $prop.Value }
    } elseif ($Value -is [array]) {
        foreach ($item in $Value) { $found += Walk-Json $item }
    }
    return $found
}

function Extract-JsonProducts($Page) {
    $products = @()
    $patterns = @(
        "<script[^>]*type=[""']application/ld\+json[""'][^>]*>(.*?)</script>",
        "<script[^>]*id=[""']__NEXT_DATA__[""'][^>]*>(.*?)</script>"
    )
    foreach ($pattern in $patterns) {
        foreach ($match in [regex]::Matches($Page, $pattern, "IgnoreCase,Singleline")) {
            try {
                $json = [System.Net.WebUtility]::HtmlDecode($match.Groups[1].Value.Trim()) | ConvertFrom-Json
                $products += Walk-Json $json
            } catch {}
        }
    }
    return $products
}

function Extract-GenericProducts($Page) {
    $text = Clean-PageText $Page
    $products = @()
    foreach ($match in [regex]::Matches($text, "(.{0,90}?)(R\s*[0-9]+(?:[\.,][0-9]{2})?)(.{0,70})", "IgnoreCase")) {
        $amount = Get-Money $match.Groups[2].Value
        $label = Clean-Text ($match.Groups[1].Value + " " + $match.Groups[3].Value)
        if ($amount -and $label) {
            $products += [pscustomobject]@{ name = $label; price = $amount; url = $null }
        }
    }
    return $products
}

function Convert-HtmlToLines($Page) {
    $text = [System.Net.WebUtility]::HtmlDecode([string]$Page)
    $text = $text -replace "<script\b[^<]*(?:(?!</script>)<[^<]*)*</script>", " "
    $text = $text -replace "<style\b[^<]*(?:(?!</style>)<[^<]*)*</style>", " "
    $text = $text -replace "(?i)</?(div|p|li|br|h[1-6]|section|article|span|a|button|strong|small|cms-price|ui-[^> ]+|cx-[^> ]+)[^>]*>", "`n"
    $text = $text -replace "<[^>]+>", " "
    return @($text -split "(`r`n|`n|`r)" | ForEach-Object { Clean-Text $_ } | Where-Object { $_ })
}

function Extract-LineProducts($Page, $Query, $BaseUrl) {
    $lines = Convert-HtmlToLines $Page
    $products = @()
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $name = $lines[$i]
        if (-not (Test-ProductText $name)) { continue }
        $score = Get-ProductScore $Query $name
        if ($score -lt 0.38) { continue }
        $start = [math]::Max($i - 2, 0)
        $end = [math]::Min($i + 8, $lines.Count - 1)
        $window = ($lines[$start..$end] -join " ")
        $priceMatches = @([regex]::Matches($window, "R\s*([0-9]+(?:[\.,][0-9]{2})?)(?:\s*/\s*kg|/kg)?", "IgnoreCase"))
        if ($priceMatches.Count -eq 0) { continue }
        $price = Get-Money $priceMatches[0].Value
        if ($null -eq $price -or $price -le 0 -or $price -gt 1000) { continue }
        $products += [pscustomobject]@{
            name = $name
            price = $price
            url = $null
            score = $score
        }
    }
    return $products
}

function Get-LinePrices($Lines, $Start, $End) {
    $prices = @()
    for ($i = $Start; $i -le $End; $i++) {
        $line = $Lines[$i]
        if ($line -match "^(SAVE|Deal expires|Was|Now|Valid from|Combo)\b") { continue }
        if ($line -match "R0\.00|delivery|address|Smart Shopper|Add to cart|Add to Basket") { continue }
        $price = $null
        if ($line -match "^R\s*([0-9]+)$" -and $i -lt $End -and $Lines[$i + 1] -match "^\.\s*([0-9]{2})$") {
            $whole = [regex]::Match($line, "^R\s*([0-9]+)$").Groups[1].Value
            $cents = [regex]::Match($Lines[$i + 1], "^\.\s*([0-9]{2})$").Groups[1].Value
            $price = [double]("$whole.$cents")
        } elseif ($line -match "R\s*[0-9]+(?:[\.,][0-9]{2})?") {
            $price = Get-Money $line
        }
        if ($null -ne $price -and $price -gt 0 -and $price -lt 2000) {
            $prices += [pscustomobject]@{ price = [math]::Round($price, 2); text = $line; index = $i }
        }
    }
    return $prices
}

function Get-PromotionInfo($Lines, $Start, $End, $SalePrice) {
    $info = [pscustomobject]@{
        regularPrice = $null
        savings = $null
        promoText = ""
        promoType = ""
        promoApplied = $false
    }
    if ($null -eq $SalePrice -or $Lines.Count -eq 0) { return $info }
    $startIndex = [math]::Max(0, $Start)
    $endIndex = [math]::Min($End, $Lines.Count - 1)
    if ($endIndex -lt $startIndex) { return $info }

    $window = @($Lines[$startIndex..$endIndex])
    $prices = @(Get-LinePrices $Lines $startIndex $endIndex)
    foreach ($price in $prices) {
        if ($price.text -match "Combo|MUST ADD|Valid from|Buy\s|[0-9]+\s*For\s*R|For\s*R[0-9]") { continue }
        if ([double]$price.price -gt ([double]$SalePrice + 0.01)) {
            $info.regularPrice = [math]::Round([double]$price.price, 2)
            $info.savings = [math]::Round($info.regularPrice - [double]$SalePrice, 2)
            $info.promoType = "shelf-special"
            $info.promoApplied = $true
            break
        }
    }

    $promoLines = @($window | Where-Object {
        $_ -match "SAVE|Smart Shopper|Was|Now|Valid from|Combo|MUST ADD|Buy\s|[0-9]+\s*For\s*R|For\s*R[0-9]"
    } | Select-Object -First 4)

    $combo = $promoLines | Where-Object { $_ -match "Combo|MUST ADD|Buy\s|[0-9]+\s*For\s*R|For\s*R[0-9]" } | Select-Object -First 1
    if ($info.savings -and $info.savings -gt 0) {
        $info.promoText = "Special: was R$($info.regularPrice), now R$([math]::Round([double]$SalePrice, 2)), save R$($info.savings)"
        $smartShopper = $promoLines | Where-Object { $_ -match "Smart Shopper" } | Select-Object -First 1
        if ($smartShopper) { $info.promoText += " - Smart Shopper" }
        if ($combo) { $info.promoText += " | Combo/multibuy also available, not applied" }
    } else {
        if ($combo) {
            $info.promoType = "combo"
            $info.promoApplied = $false
            $info.promoText = "Combo/multibuy available, not applied: $(Clean-Text $combo)"
        }
    }
    return $info
}

function Extract-CheckersProductPage($Page, $Query, $Url) {
    $products = @()
    $name = $null
    $schemaPrice = $null
    $nextPrice = $null
    foreach ($match in [regex]::Matches($Page, "<script[^>]*type=[""']application/ld\+json[""'][^>]*>(.*?)</script>", "IgnoreCase,Singleline")) {
        try {
            $json = [System.Net.WebUtility]::HtmlDecode($match.Groups[1].Value.Trim()) | ConvertFrom-Json
            if ($json.'@type' -eq "Product") {
                if ($json.name) { $name = Clean-Text $json.name }
                if ($json.offers -and $json.offers.price) { $schemaPrice = Get-Money $json.offers.price }
            }
        } catch {}
    }
    foreach ($match in [regex]::Matches($Page, "<script[^>]*id=[""']__NEXT_DATA__[""'][^>]*>(.*?)</script>", "IgnoreCase,Singleline")) {
        try {
            $json = [System.Net.WebUtility]::HtmlDecode($match.Groups[1].Value.Trim()) | ConvertFrom-Json
            $product = $json.props.pageProps.serverProduct
            if ($product) {
                if (-not $name -and $product.displayName) { $name = Clean-Text $product.displayName }
                if (-not $name -and $product.name) { $name = Clean-Text $product.name }
                if ($product.price) { $nextPrice = Get-Money $product.price }
                if ($null -eq $nextPrice -and $product.discountedPrice) { $nextPrice = Get-Money $product.discountedPrice }
                if ($null -eq $nextPrice -and $product.priceWithoutDecimal) { $nextPrice = [math]::Round(([double]$product.priceWithoutDecimal / 100), 2) }
            }
        } catch {}
    }
    if (-not $name) {
        $meta = [regex]::Match($Page, '<meta[^>]+property=["'']og:title["''][^>]+content=["'']([^"'']+)["'']', "IgnoreCase")
        if ($meta.Success) { $name = Clean-Text $meta.Groups[1].Value }
    }
    if (-not $name) { $name = Clean-Text $Query }

    $lines = Convert-HtmlToLines $Page
    $nameIndex = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ((Get-ProductScore $name $lines[$i]) -ge 0.7 -or (Get-ProductScore $Query $lines[$i]) -ge 0.7) {
            $nameIndex = $i
            break
        }
    }

    $visiblePrice = $null
    $promotion = $null
    if ($nameIndex -ge 0) {
        $start = [math]::Max($nameIndex, 0)
        $end = [math]::Min($nameIndex + 18, $lines.Count - 1)
        $window = @($lines[$start..$end])
        $perKg = $window | Where-Object { $_ -match "R\s*[0-9]+(?:[\.,][0-9]{2})?\s*(per kilogram|p/kg|/kg)" } | Select-Object -First 1
        if ($perKg -and ((Normalize-ProductPhrase $Query) -match "\b[0-9]+kg\b" -or (Normalize-ProductPhrase $name) -match "\bper kg\b")) {
            $visiblePrice = Get-Money $perKg
        }
        if ($null -eq $visiblePrice) {
            $prices = @(Get-LinePrices $lines $start $end)
            if ($prices.Count -gt 0) { $visiblePrice = $prices[0].price }
        }
        if ($null -ne $visiblePrice) { $promotion = Get-PromotionInfo $lines $start $end $visiblePrice }
    }

    $price = $(if ($null -ne $visiblePrice) { $visiblePrice } elseif ($null -ne $nextPrice) { $nextPrice } else { $schemaPrice })
    if ($name -and $price) {
        $products += [pscustomobject]@{
            name = $name
            price = $price
            url = $Url
            score = [math]::Max(1.2, (Get-ProductScore $Query $name))
            regularPrice = $(if ($promotion) { $promotion.regularPrice } else { $null })
            savings = $(if ($promotion) { $promotion.savings } else { $null })
            promoText = $(if ($promotion) { $promotion.promoText } else { "" })
            promoType = $(if ($promotion) { $promotion.promoType } else { "" })
            promoApplied = $(if ($promotion) { $promotion.promoApplied } else { $false })
        }
    }
    return $products
}

function Extract-PickNPayProductPage($Page, $Query, $Url) {
    $products = @()
    $name = Get-MetaContent $Page "og:title"
    if ($name) { $name = ($name -replace "\s*\|\s*PnP\s*$", "").Trim() }
    if (-not $name) {
        $titleMatch = [regex]::Match($Page, "<title[^>]*>(.*?)</title>", "IgnoreCase,Singleline")
        if ($titleMatch.Success) { $name = (Clean-Text $titleMatch.Groups[1].Value) -replace "\s*\|\s*PnP\s*$", "" }
    }
    if (-not $name) { $name = Clean-Text $Query }

    $lines = Convert-HtmlToLines $Page
    if ($lines.Count -eq 0) { return $products }

    $nameIndex = -1
    $bestNameScore = -999.0
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]
        $score = [math]::Max((Get-ProductScore $name $line), (Get-ProductScore $Query $line))
        if ($score -ge 0.65) {
            $lookaheadEnd = [math]::Min($i + 80, $lines.Count - 1)
            $window = $(if ($lookaheadEnd -gt $i) { $lines[$i..$lookaheadEnd] -join " " } else { $line })
            $clusterScore = $score
            if ($window -match "Add to cart") { $clusterScore += 1.0 }
            if ($window -match "R\s*[0-9]+(?:[\.,][0-9]{2})?") { $clusterScore += 0.6 }
            if ($line -match "\|\s*PnP\s*$|Pick n Pay Online Shopping") { $clusterScore -= 1.0 }
            if ($clusterScore -gt $bestNameScore) {
                $bestNameScore = $clusterScore
                $nameIndex = $i
            }
        }
    }
    if ($nameIndex -lt 0) { $nameIndex = 0 }

    $end = [math]::Min($nameIndex + 45, $lines.Count - 1)
    for ($i = $nameIndex + 1; $i -le $end; $i++) {
        if ($lines[$i] -match "^(Add to cart|Product Info|Description|SKU)$") {
            $end = $i
            break
        }
    }

    $price = $null
    $priceLine = $null
    for ($i = $nameIndex + 1; $i -le $end; $i++) {
        $line = $lines[$i]
        if ($line -match "Combo|Valid from|MUST ADD|Smart Shopper|SAVE|PNP|Delivery|address|R0\.00") { continue }
        if ($line -match "R\s*[0-9]+(?:[\.,][0-9]{2})?(?:\s*/\s*kg|/kg)?") {
            $price = Get-Money $line
            $priceLine = $line
            break
        }
    }
    if ($null -eq $price) {
        $prices = @(Get-LinePrices $lines ([math]::Min($nameIndex + 1, $lines.Count - 1)) $end)
        if ($prices.Count -gt 0) {
            $price = $prices[0].price
            $priceLine = $prices[0].text
        }
    }

    $promotion = $null
    if ($null -ne $price) { $promotion = Get-PromotionInfo $lines $nameIndex $end $price }

    if ($name -and $price) {
        $displayName = $(if ($priceLine -match "/kg|per kg|p/kg") { "$name per kg" } else { $name })
        $products += [pscustomobject]@{
            name = Clean-Text $displayName
            price = $price
            url = $Url
            score = [math]::Max(1.2, (Get-ProductScore $Query $name))
            regularPrice = $(if ($promotion) { $promotion.regularPrice } else { $null })
            savings = $(if ($promotion) { $promotion.savings } else { $null })
            promoText = $(if ($promotion) { $promotion.promoText } else { "" })
            promoType = $(if ($promotion) { $promotion.promoType } else { "" })
            promoApplied = $(if ($promotion) { $promotion.promoApplied } else { $false })
        }
    }
    return $products
}

function Get-MetaContent($Page, $Name, $Attribute = "property") {
    $pattern = '<meta[^>]+' + [regex]::Escape($Attribute) + '=["'']' + [regex]::Escape($Name) + '["''][^>]+content=["'']([^"'']+)["'']'
    $match = [regex]::Match($Page, $pattern, "IgnoreCase")
    if ($match.Success) { return Clean-Text $match.Groups[1].Value }
    $pattern = '<meta[^>]+content=["'']([^"'']+)["''][^>]+' + [regex]::Escape($Attribute) + '=["'']' + [regex]::Escape($Name) + '["'']'
    $match = [regex]::Match($Page, $pattern, "IgnoreCase")
    if ($match.Success) { return Clean-Text $match.Groups[1].Value }
    return $null
}

function Extract-ExactProductPage($StoreId, $Page, $Query, $Url) {
    if ($StoreId -eq "checkers") {
        return Extract-CheckersProductPage $Page $Query $Url
    }
    if ($StoreId -eq "pick-n-pay") {
        return Extract-PickNPayProductPage $Page $Query $Url
    }

    $products = @()
    foreach ($match in [regex]::Matches($Page, "<script[^>]*type=[""']application/ld\+json[""'][^>]*>(.*?)</script>", "IgnoreCase,Singleline")) {
        try {
            $json = [System.Net.WebUtility]::HtmlDecode($match.Groups[1].Value.Trim()) | ConvertFrom-Json
            foreach ($product in @(Walk-Json $json)) {
                $name = Clean-Text $product.name
                $price = Get-Money $product.price
                $score = Get-ProductScore $Query $name
                if ($name -and $price -and $score -ge 0.3) {
                    $products += [pscustomobject]@{
                        name = $name
                        price = $price
                        url = $(if ($product.url) { $product.url } else { $Url })
                        score = [math]::Max(1.15, $score)
                    }
                }
            }
        } catch {}
    }
    if ($products.Count -gt 0) { return $products }

    $name = Get-MetaContent $Page "og:title"
    if (-not $name) { $name = Get-MetaContent $Page "twitter:title" "name" }
    if (-not $name) {
        $titleMatch = [regex]::Match($Page, "<title[^>]*>(.*?)</title>", "IgnoreCase,Singleline")
        if ($titleMatch.Success) { $name = Clean-Text $titleMatch.Groups[1].Value }
    }
    if (-not $name) { $name = Clean-Text $Query }

    $lines = Convert-HtmlToLines $Page
    $nameIndex = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ((Get-ProductScore $name $lines[$i]) -ge 0.55 -or (Get-ProductScore $Query $lines[$i]) -ge 0.55) {
            $nameIndex = $i
            break
        }
    }
    if ($nameIndex -lt 0) { $nameIndex = 0 }
    $start = [math]::Min([math]::Max($nameIndex + 1, 0), [math]::Max($lines.Count - 1, 0))
    $end = [math]::Min($nameIndex + 35, $lines.Count - 1)
    if ($lines.Count -eq 0) { return $products }

    $prices = @(Get-LinePrices $lines $start $end)
    if ($prices.Count -eq 0) { $prices = @(Get-LinePrices $lines 0 ([math]::Min(80, $lines.Count - 1))) }
    if ($prices.Count -gt 0) {
        $products += [pscustomobject]@{
            name = $name
            price = $prices[0].price
            url = $Url
            score = [math]::Max(1.1, (Get-ProductScore $Query $name))
        }
    }
    return $products
}

function Extract-RenderedProducts($Page, $Query, $BaseUrl) {
    $products = @()
    foreach ($match in [regex]::Matches($Page, 'class="[^"]*product-grid-item[^"]*"[^>]*aria-label="([^"]+)"[^>]*aria-description="[^"]*?([0-9]+(?:\.[0-9]{2})?)\s*rands', "IgnoreCase,Singleline")) {
        $name = Clean-Text $match.Groups[1].Value
        $price = Get-Money $match.Groups[2].Value
        if ($name -and $price) {
            $products += [pscustomobject]@{ name = $name; price = $price; url = $null; score = Get-ProductScore $Query $name }
        }
    }
    foreach ($match in [regex]::Matches($Page, '<a[^>]+class="[^"]*product[^"]*name[^"]*"[^>]*href="([^"]+)"[^>]*>.*?<span[^>]*>(.*?)</span>.*?class="price"[^>]*>\s*(R\s*[0-9]+(?:[\.,][0-9]{2})?(?:\s*/\s*kg|/kg)?)', "IgnoreCase,Singleline")) {
        $name = Clean-Text $match.Groups[2].Value
        $price = Get-Money $match.Groups[3].Value
        $url = $match.Groups[1].Value
        if ($url -and $url.StartsWith("/")) { $url = $BaseUrl.TrimEnd("/") + $url }
        if ($name -and $price) {
            $products += [pscustomobject]@{ name = $name; price = $price; url = $url; score = Get-ProductScore $Query $name }
        }
    }
    $products += Extract-LineProducts $Page $Query $BaseUrl
    return $products
}

function Dedupe-Products($Products) {
    $seen = @{}
    $unique = @()
    foreach ($product in $Products) {
        $name = Clean-Text $product.name
        $price = Get-Money $product.price
        if (-not $name -or -not $price) { continue }
        if (Test-JunkProductName $name) { continue }
        if (-not ($product.PSObject.Properties.Name -contains "score")) { continue }
        if ([double]$product.score -lt 0.38) { continue }
        $key = "$($name.ToLowerInvariant())|$price"
        if ($seen.ContainsKey($key)) { continue }
        $seen[$key] = $true
        $unique += [pscustomobject]@{
            name = $name
            price = $price
            url = $product.url
            score = $(if ($product.PSObject.Properties.Name -contains "score") { [double]$product.score } else { 0 })
            regularPrice = $(if ($product.PSObject.Properties.Name -contains "regularPrice") { $product.regularPrice } else { $null })
            savings = $(if ($product.PSObject.Properties.Name -contains "savings") { $product.savings } else { $null })
            promoText = $(if ($product.PSObject.Properties.Name -contains "promoText") { $product.promoText } else { "" })
            promoType = $(if ($product.PSObject.Properties.Name -contains "promoType") { $product.promoType } else { "" })
            promoApplied = $(if ($product.PSObject.Properties.Name -contains "promoApplied") { [bool]$product.promoApplied } else { $false })
        }
    }
    return $unique
}

function Test-JunkProductName($Name) {
    $text = ([string]$Name).ToLowerInvariant()
    $junkTokens = @(
        "font-weight", "font-display", "woff", "src:url", "format(", "_media",
        "categoryurl", "categoryname", "navigation", "showinmobile",
        "_content_type_uid", "sub_cats", ".png", ".jpg", ".webp", "appbanner",
        "captcha", "cookie", "function(", "stylesheet", "scriptloader", "suburb-selector",
        "window.", "document.", "webpack", "buildid"
    )
    foreach ($token in $junkTokens) {
        if ($text.Contains($token)) { return $true }
    }
    if ($text -match "[{}\\]{2,}") { return $true }
    return $false
}

function Scan-Store($Store, $Item, $Settings) {
    $query = $Item.query
    if (-not $query) { $query = $Item.name }
    $encoded = [Uri]::EscapeDataString($query).Replace("%20", "+")
    $pathEncoded = [Uri]::EscapeDataString($query)
    $url = $Store.searchUrl.Replace("{query}", $encoded).Replace("{pathQuery}", $pathEncoded)
    $directUrl = Get-ItemProductLink $Store.id $Item $query
    if ($directUrl) { $url = $directUrl }
    $started = Get-Date
    try {
        $products = @()
        $lastReadError = $null
        if ($directUrl) {
            try {
                $page = Fetch-Page $directUrl
                $products += @(Extract-ExactProductPage $Store.id $page $query $directUrl)
            } catch {
                $lastReadError = $_.Exception.Message
            }
        }
        $needsRenderedPass = $products.Count -eq 0
        if ($directUrl -and $Store.id -in @("pick-n-pay", "checkers")) { $needsRenderedPass = $true }
        if ($needsRenderedPass -and $Store.id -in @("pick-n-pay", "woolworths", "checkers")) {
            if ($Store.id -eq "woolworths") {
                $url = "https://www.woolworths.co.za/browse?searchterm=$pathEncoded&fr=1"
            } elseif ($directUrl) {
                $url = $directUrl
            }
            try {
                $rendered = Invoke-RenderedPage $url
                if ($rendered) {
                    if ($directUrl) {
                        $products += Extract-ExactProductPage $Store.id $rendered $query $directUrl
                    } else {
                        $products += Extract-RenderedProducts $rendered $query ([Uri]$url).GetLeftPart([System.UriPartial]::Authority)
                    }
                }
            } catch {
                $lastReadError = $_.Exception.Message
            }
        }
        if ($products.Count -eq 0) {
            foreach ($variant in Get-QueryVariants $query) {
                $variantEncoded = [Uri]::EscapeDataString($variant).Replace("%20", "+")
                $variantPathEncoded = [Uri]::EscapeDataString($variant)
                $variantUrl = $Store.searchUrl.Replace("{query}", $variantEncoded).Replace("{pathQuery}", $variantPathEncoded)
                if ($Store.id -eq "woolworths") { $variantUrl = "https://www.woolworths.co.za/browse?searchterm=$variantPathEncoded&fr=1" }
                if ($directUrl) { $variantUrl = $directUrl }
                try {
                    $page = Fetch-Page $variantUrl
                    if ($directUrl) {
                        $products += @(Extract-ExactProductPage $Store.id $page $query $directUrl)
                    } else {
                        $products += @(Extract-LineProducts $page $query ([Uri]$variantUrl).GetLeftPart([System.UriPartial]::Authority))
                    }
                    if ($products.Count -gt 0) {
                        $url = $variantUrl
                        break
                    }
                } catch {
                    $lastReadError = $_.Exception.Message
                }
            }
        }
        $products = Dedupe-Products $products
        $ranked = $products | Sort-Object @{ Expression = { -([double]$_.score) } }, @{ Expression = { $_.price } }
        $limit = [int]($Settings.maxResultsPerStore)
        if ($limit -lt 1) { $limit = 6 }
        $best = $ranked | Select-Object -First 1
        $elapsed = [math]::Round(((Get-Date) - $started).TotalMilliseconds)
        if ($best) {
            $productMeasure = Get-ProductMeasure $best.name $(if ($best.url) { $best.url } else { $directUrl }) $query
            return [pscustomobject]@{
                storeId = $Store.id; storeName = $Store.name; status = "ok"; queryUrl = $url
                price = $best.price; productName = $best.name; productUrl = $(if ($best.url) { $best.url } else { $directUrl })
                productMeasure = $productMeasure
                regularPrice = $best.regularPrice
                savings = $best.savings
                promoText = $best.promoText
                promoType = $best.promoType
                promoApplied = $best.promoApplied
                candidates = @($ranked | Select-Object -First $limit)
                elapsedMs = $elapsed; message = ""
            }
        }
        return [pscustomobject]@{
            storeId = $Store.id; storeName = $Store.name; status = "no-price-found"; queryUrl = $url
            price = $null; productName = $null; productUrl = $directUrl; productMeasure = $null; candidates = @()
            elapsedMs = $elapsed; message = $(if ($lastReadError) { "No product-like price match was found. The retailer may be blocking automated reads: $lastReadError" } else { "No product-like price match was found for this item." })
        }
    } catch {
        $elapsed = [math]::Round(((Get-Date) - $started).TotalMilliseconds)
        return [pscustomobject]@{
            storeId = $Store.id; storeName = $Store.name; status = "error"; queryUrl = $url
            price = $null; productName = $null; productUrl = $null; productMeasure = $null; candidates = @()
            elapsedMs = $elapsed; message = $_.Exception.Message
        }
    }
}

function Apply-ValueAdjustments($Scan, $Settings) {
    $quantity = [double]($Scan.quantity)
    $targetMeasure = $Scan.targetMeasure
    foreach ($result in $Scan.results) {
        if ($null -eq $result.price) {
            $result | Add-Member -Force NoteProperty effectivePrice $null
            $result | Add-Member -Force NoteProperty normalizedPrice $null
            $result | Add-Member -Force NoteProperty lineTotal $null
            $result | Add-Member -Force NoteProperty valueAdjustments @()
            continue
        }
        $effective = [double]$result.price
        $adjustments = @()
        $normalized = Get-NormalizedLinePrice $effective $result.productMeasure $targetMeasure 1
        $result | Add-Member -Force NoteProperty effectivePrice ([math]::Round($effective, 2))
        $result | Add-Member -Force NoteProperty normalizedPrice $normalized
        $result | Add-Member -Force NoteProperty lineTotal ([math]::Round($normalized * $quantity, 2))
        $result | Add-Member -Force NoteProperty valueAdjustments $adjustments
    }
    $priced = @($Scan.results | Where-Object { $null -ne $_.effectivePrice } | Sort-Object effectivePrice)
    $best = $priced | Select-Object -First 1
    $Scan | Add-Member -Force NoteProperty bestStoreId $(if ($best) { $best.storeId } else { $null })
    $Scan | Add-Member -Force NoteProperty bestStoreName $(if ($best) { $best.storeName } else { $null })
    $Scan | Add-Member -Force NoteProperty bestEffectivePrice $(if ($best) { $best.effectivePrice } else { $null })
    return $Scan
}

function Run-Scan {
    Ensure-Files
    $items = Read-JsonFile $ItemsFile $DefaultItems
    $settings = Read-JsonFile $SettingsFile $DefaultSettings
    $enabled = $settings.stores
    $scans = @()
    foreach ($item in $items) {
        $itemScan = [pscustomobject]@{
            itemId = $item.id
            name = $item.name
            query = $(if ($item.query) { $item.query } else { $item.name })
            quantity = $(if ($item.quantity) { $item.quantity } else { 1 })
            category = $(if ($item.category) { $item.category } else { "" })
            targetSize = $(if ($item.PSObject.Properties.Name -contains "targetSize") { Clean-Text $item.targetSize } else { "" })
            targetMeasure = $(Get-TargetMeasure $item)
            links = $(Normalize-ItemLinks $item.links)
            results = @()
        }
        foreach ($store in $Stores) {
            $isEnabled = $true
            if ($enabled.PSObject.Properties.Name -contains $store.id) { $isEnabled = [bool]$enabled.($store.id) }
            if ($isEnabled) { $itemScan.results += Scan-Store $store $item $settings }
        }
        $scans += Apply-ValueAdjustments $itemScan $settings
    }

    $basketTotals = [ordered]@{}
    foreach ($store in $Stores) {
        $isEnabled = $true
        if ($enabled.PSObject.Properties.Name -contains $store.id) { $isEnabled = [bool]$enabled.($store.id) }
        if (-not $isEnabled) { continue }
        $total = 0.0
        $missing = 0
        foreach ($scan in $scans) {
            $result = $scan.results | Where-Object { $_.storeId -eq $store.id } | Select-Object -First 1
            if ($null -eq $result -or $null -eq $result.lineTotal) { $missing += 1 } else { $total += [double]$result.lineTotal }
        }
        $basketTotals[$store.id] = [pscustomobject]@{ storeId = $store.id; storeName = $store.name; total = [math]::Round($total, 2); missing = $missing }
    }
    $bestBasket = $basketTotals.Values | Where-Object { $_.missing -eq 0 } | Sort-Object total | Select-Object -First 1
    $entry = [pscustomobject]@{
        id = [guid]::NewGuid().ToString()
        createdAt = (Get-Date).ToUniversalTime().ToString("o")
        settings = $settings
        items = [object[]]$items
        scans = [object[]]$scans
        basketTotals = $basketTotals
        bestBasketStoreId = $(if ($bestBasket) { $bestBasket.storeId } else { $null })
    }
    $history = Read-JsonFile $HistoryFile @()
    $history = @($entry) + @($history | Select-Object -First 51)
    Write-JsonFile $HistoryFile $history
    return $entry
}

function Get-CatalogueProductForItem($Item) {
    $catalogue = Get-Catalogue
    $itemId = [string]$Item.id
    foreach ($product in $catalogue) {
        if ($itemId -and $itemId.StartsWith([string]$product.id)) { return $product }
    }
    if ($Item.PSObject.Properties.Name -contains "links" -and $Item.links) {
        foreach ($product in $catalogue) {
            foreach ($storeMatch in @($product.stores)) {
                if (-not $storeMatch.url) { continue }
                if ($Item.links.PSObject.Properties.Name -contains $storeMatch.storeId) {
                    $itemUrl = [string]$Item.links.($storeMatch.storeId)
                    if ($itemUrl -and $itemUrl -eq [string]$storeMatch.url) { return $product }
                }
            }
        }
    }
    $query = $(if ($Item.query) { $Item.query } else { $Item.name })
    $best = Search-Catalogue $query 1 | Select-Object -First 1
    if ($best -and [double]$best.score -ge 2) {
        return $catalogue | Where-Object { $_.id -eq $best.id } | Select-Object -First 1
    }
    return $null
}

function New-CachedStoreResult($Store, $Item, $CatalogueProduct) {
    if (-not $CatalogueProduct) {
        return [pscustomobject]@{
            storeId = $Store.id; storeName = $Store.name; status = "catalogue-missing"; queryUrl = $null
            price = $null; productName = $null; productUrl = $null; productMeasure = $null; candidates = @()
            elapsedMs = 0; message = "This item is not linked to a verified catalogue product yet."
        }
    }
    $storeMatch = @($CatalogueProduct.stores) | Where-Object { $_.storeId -eq $Store.id } | Select-Object -First 1
    if (-not $storeMatch) {
        return [pscustomobject]@{
            storeId = $Store.id; storeName = $Store.name; status = "catalogue-store-missing"; queryUrl = $null
            price = $null; productName = $null; productUrl = $null; productMeasure = $null; candidates = @()
            elapsedMs = 0; message = "No catalogue row is saved for this retailer yet."
        }
    }
    $price = Get-Money $storeMatch.price
    if ($null -eq $price -and $storeMatch.normalisedPriceForTarget) { $price = Get-Money $storeMatch.normalisedPriceForTarget }
    if ($null -eq $price) {
        return [pscustomobject]@{
            storeId = $Store.id; storeName = $Store.name; status = "catalogue-price-missing"; queryUrl = $storeMatch.url
            price = $null; productName = $storeMatch.productName; productUrl = $storeMatch.url; productMeasure = $null; candidates = @()
            elapsedMs = 0; message = "This catalogue product has no cached price yet. It needs a background refresh."
        }
    }
    $productMeasure = Parse-Measure $storeMatch.size
    if (-not $productMeasure) { $productMeasure = Get-ProductMeasure $storeMatch.productName $storeMatch.url $CatalogueProduct.canonicalName }
    if (-not $productMeasure -and $storeMatch.normalisedPriceForTarget) { $productMeasure = Get-TargetMeasure $Item }
    $lastSeen = $(if ($storeMatch.lastSeenAt) { " Last checked $($storeMatch.lastSeenAt)." } else { "" })
    return [pscustomobject]@{
        storeId = $Store.id; storeName = $Store.name; status = "cached"; queryUrl = $storeMatch.url
        price = $price; productName = $storeMatch.productName; productUrl = $storeMatch.url
        productMeasure = $productMeasure
        regularPrice = $storeMatch.regularPrice
        savings = $storeMatch.savings
        promoText = $storeMatch.promoText
        promoType = $storeMatch.promoType
        promoApplied = $storeMatch.promoApplied
        candidates = @([pscustomobject]@{
            name = $storeMatch.productName
            price = $price
            url = $storeMatch.url
            score = 1
            regularPrice = $storeMatch.regularPrice
            savings = $storeMatch.savings
            promoText = $storeMatch.promoText
            promoType = $storeMatch.promoType
            promoApplied = $storeMatch.promoApplied
        })
        elapsedMs = 0; message = "Using cached catalogue price.$lastSeen"
    }
}

function Run-CatalogueScan {
    Ensure-Files
    $items = Read-JsonFile $ItemsFile $DefaultItems
    $settings = Read-JsonFile $SettingsFile $DefaultSettings
    $enabledStores = @(Get-EnabledStores $settings)
    $scans = @()
    foreach ($item in $items) {
        $catalogueProduct = Get-CatalogueProductForItem $item
        $itemScan = [pscustomobject]@{
            itemId = $item.id
            name = $item.name
            query = $(if ($item.query) { $item.query } else { $item.name })
            quantity = $(if ($item.quantity) { $item.quantity } else { 1 })
            category = $(if ($item.category) { $item.category } else { "" })
            targetSize = $(if ($item.PSObject.Properties.Name -contains "targetSize") { Clean-Text $item.targetSize } else { "" })
            targetMeasure = $(Get-TargetMeasure $item)
            links = $(Normalize-ItemLinks $item.links)
            catalogueProductId = $(if ($catalogueProduct) { $catalogueProduct.id } else { $null })
            results = @()
        }
        foreach ($store in $enabledStores) {
            $itemScan.results += New-CachedStoreResult $store $item $catalogueProduct
        }
        $scans += Apply-ValueAdjustments $itemScan $settings
    }
    $basketTotals = [ordered]@{}
    foreach ($store in $enabledStores) {
        $total = 0.0
        $missing = 0
        foreach ($scan in $scans) {
            $result = $scan.results | Where-Object { $_.storeId -eq $store.id } | Select-Object -First 1
            if ($null -eq $result -or $null -eq $result.lineTotal) { $missing += 1 } else { $total += [double]$result.lineTotal }
        }
        $basketTotals[$store.id] = [pscustomobject]@{ storeId = $store.id; storeName = $store.name; total = [math]::Round($total, 2); missing = $missing }
    }
    $bestBasket = $basketTotals.Values | Where-Object { $_.missing -eq 0 } | Sort-Object total | Select-Object -First 1
    $entry = [pscustomobject]@{
        id = [guid]::NewGuid().ToString()
        createdAt = (Get-Date).ToUniversalTime().ToString("o")
        source = "catalogue-cache"
        settings = $settings
        items = [object[]]$items
        scans = [object[]]$scans
        basketTotals = $basketTotals
        bestBasketStoreId = $(if ($bestBasket) { $bestBasket.storeId } else { $null })
    }
    $history = Read-JsonFile $HistoryFile @()
    $history = @($entry) + @($history | Select-Object -First 51)
    Write-JsonFile $HistoryFile $history
    return $entry
}

function Get-EnabledStores($Settings) {
    $enabled = $Settings.stores
    $out = @()
    foreach ($store in $Stores) {
        $isEnabled = $true
        if ($enabled -and $enabled.PSObject.Properties.Name -contains $store.id) { $isEnabled = [bool]$enabled.($store.id) }
        if ($isEnabled) { $out += $store }
    }
    return $out
}

function Read-ScanJobs {
    return [object[]](Read-JsonFile $ScanJobsFile @())
}

function Write-ScanJobs($Jobs) {
    Write-JsonFile $ScanJobsFile ([object[]]$Jobs)
}

function Upsert-ScanJob($Job) {
    Ensure-Files
    $jobs = @(Read-ScanJobs)
    $next = @()
    $found = $false
    foreach ($existing in $jobs) {
        if ($existing.id -eq $Job.id) {
            $next += $Job
            $found = $true
        } else {
            $next += $existing
        }
    }
    if (-not $found) { $next = @($Job) + $next }
    Write-ScanJobs (@($next | Select-Object -First 30))
}

function Get-ScanJob($JobId) {
    $jobs = @(Read-ScanJobs)
    return $jobs | Where-Object { $_.id -eq $JobId } | Select-Object -First 1
}

function Start-ScanJob {
    Ensure-Files
    $items = [object[]](Read-JsonFile $ItemsFile $DefaultItems)
    $settings = Read-JsonFile $SettingsFile $DefaultSettings
    $enabledStores = @(Get-EnabledStores $settings)
    $jobId = [guid]::NewGuid().ToString()
    $job = [pscustomobject]@{
        id = $jobId
        status = "queued"
        progress = 0
        completedChecks = 0
        totalChecks = [math]::Max(1, $items.Count * [math]::Max(1, $enabledStores.Count))
        currentItem = ""
        currentStore = ""
        message = "Queued price check"
        createdAt = (Get-Date).ToUniversalTime().ToString("o")
        updatedAt = (Get-Date).ToUniversalTime().ToString("o")
        result = $null
        error = ""
    }
    Upsert-ScanJob $job

    $runner = Join-Path $Root "Run-ScanJob.ps1"
    if (-not (Test-Path -LiteralPath $runner)) {
        $job.status = "error"
        $job.error = "Missing scan runner: $runner"
        $job.message = $job.error
        Upsert-ScanJob $job
        return $job
    }

    $powerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    $args = '-NoProfile -ExecutionPolicy Bypass -File "' + $runner + '" -JobId "' + $jobId + '"'
    try {
        Start-Process -FilePath $powerShell -ArgumentList $args -WorkingDirectory $Root -WindowStyle Hidden | Out-Null
        $job.status = "running"
        $job.message = "Starting retailer checks"
        $job.updatedAt = (Get-Date).ToUniversalTime().ToString("o")
        Upsert-ScanJob $job
    } catch {
        $job.status = "error"
        $job.error = $_.Exception.Message
        $job.message = "Could not start scan job"
        $job.updatedAt = (Get-Date).ToUniversalTime().ToString("o")
        Upsert-ScanJob $job
    }
    return $job
}

function Add-CatalogueRequest($Body) {
    Ensure-Files
    $query = Clean-Text $(if ($Body.query) { $Body.query } else { $Body.name })
    if ([string]::IsNullOrWhiteSpace($query)) {
        throw "Missing catalogue request query."
    }
    $requests = @(Read-JsonFile $CatalogueRequestsFile @())
    foreach ($existing in $requests) {
        if ((Clean-Text $existing.query).ToLowerInvariant() -eq $query.ToLowerInvariant() -and
            $existing.status -in @("queued", "running", "requested")) {
            return $existing
        }
    }
    $entry = [pscustomobject]@{
        id = [guid]::NewGuid().ToString()
        query = $query
        name = Clean-Text $(if ($Body.name) { $Body.name } else { $query })
        source = Clean-Text $(if ($Body.source) { $Body.source } else { "mobile" })
        status = "queued"
        foundCount = 0
        publishedCount = 0
        message = "Queued catalogue discovery"
        createdAt = (Get-Date).ToUniversalTime().ToString("o")
        updatedAt = (Get-Date).ToUniversalTime().ToString("o")
    }
    $requests = @($entry) + @($requests | Select-Object -First 199)
    Write-JsonFile $CatalogueRequestsFile $requests
    Start-CatalogueRequestJob $entry.id | Out-Null
    return $entry
}

function Start-CatalogueRequestJob([string]$RequestId) {
    $runner = Join-Path $Root "Run-CatalogueRequestJob.ps1"
    if (-not (Test-Path -LiteralPath $runner)) { return $false }
    $powerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    $args = '-NoProfile -ExecutionPolicy Bypass -File "' + $runner + '" -RequestId "' + $RequestId + '"'
    try {
        Start-Process -FilePath $powerShell -ArgumentList $args -WorkingDirectory $Root -WindowStyle Hidden | Out-Null
        return $true
    } catch {
        return $false
    }
}

function New-JsonResponse($Value, $Status = 200) {
    return @{
        status = $Status
        contentType = "application/json; charset=utf-8"
        body = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $Value -Depth 40))
    }
}

function Read-BodyJson($Request) {
    $raw = $Request.body
    if ([string]::IsNullOrWhiteSpace($raw)) { return @{} }
    return $raw | ConvertFrom-Json
}

function New-FileResponse($Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return @{
            status = 404
            contentType = "text/plain; charset=utf-8"
            body = [Text.Encoding]::UTF8.GetBytes("Not found")
        }
    }
    $extension = [IO.Path]::GetExtension($Path).ToLowerInvariant()
    $mime = switch ($extension) {
        ".html" { "text/html; charset=utf-8" }
        ".css" { "text/css; charset=utf-8" }
        ".js" { "application/javascript; charset=utf-8" }
        ".json" { "application/json; charset=utf-8" }
        ".webmanifest" { "application/manifest+json; charset=utf-8" }
        ".svg" { "image/svg+xml; charset=utf-8" }
        default { "application/octet-stream" }
    }
    return @{
        status = 200
        contentType = $mime
        body = [IO.File]::ReadAllBytes($Path)
    }
}

function Route-Request($Request) {
    Ensure-Files
    $path = $Request.path
    if ($Request.method -eq "GET" -and $path -eq "/api/state") {
        $history = Read-JsonFile $HistoryFile @()
        return New-JsonResponse @{
            items = [object[]](Read-JsonFile $ItemsFile $DefaultItems)
            settings = (Read-JsonFile $SettingsFile $DefaultSettings)
            history = [object[]]@($history | Select-Object -First 12)
            stores = [object[]]$Stores
            localUrl = "http://127.0.0.1:$Port"
            mobileUrl = Get-LanUrl
        }
    }
    if ($Request.method -eq "GET" -and $path -eq "/api/history") {
        return New-JsonResponse ([object[]](Read-JsonFile $HistoryFile @()))
    }
    if ($Request.method -eq "GET" -and $path -eq "/api/scan/status") {
        $jobId = ""
        if ($Request.query.ContainsKey("id")) { $jobId = $Request.query["id"] }
        if ([string]::IsNullOrWhiteSpace($jobId)) {
            return New-JsonResponse @{ ok = $false; error = "Missing scan job id." } 500
        }
        $job = Get-ScanJob $jobId
        if (-not $job) {
            return New-JsonResponse @{ ok = $false; error = "Scan job not found." } 404
        }
        return New-JsonResponse @{ ok = $true; job = $job }
    }
    if ($Request.method -eq "GET" -and $path -eq "/api/catalogue") {
        $query = ""
        if ($Request.query.ContainsKey("q")) { $query = $Request.query["q"] }
        $limit = 25
        if ($Request.query.ContainsKey("limit")) {
            try { $limit = [int]$Request.query["limit"] } catch { $limit = 25 }
        }
        if ($limit -lt 1) { $limit = 25 }
        if ($limit -gt 100) { $limit = 100 }
        $page = 1
        if ($Request.query.ContainsKey("page")) {
            try { $page = [int]$Request.query["page"] } catch { $page = 1 }
        }
        if ($page -lt 1) { $page = 1 }
        $pageResults = [object[]](Search-Catalogue $query ($limit + 1) (($page - 1) * $limit))
        $retailerMatches = if ($page -eq 1) { [object[]](Get-CatalogueRetailerMatches $query) } else { @() }
        return New-JsonResponse @{
            ok = $true
            query = $query
            page = $page
            pageSize = $limit
            hasMore = $pageResults.Count -gt $limit
            products = [object[]]@($pageResults | Select-Object -First $limit)
            retailerMatches = $retailerMatches
        }
    }
    if ($Request.method -eq "GET" -and $path -eq "/api/catalogue/categories") {
        return New-JsonResponse @{
            ok = $true
            categories = [object[]](Get-CatalogueCategories)
        }
    }
    if ($Request.method -eq "POST" -and $path -eq "/api/catalogue/request") {
        try {
            $requestEntry = Add-CatalogueRequest (Read-BodyJson $Request)
            return New-JsonResponse @{ ok = $true; request = $requestEntry }
        } catch {
            return New-JsonResponse @{ ok = $false; error = $_.Exception.Message } 500
        }
    }
    if ($Request.method -eq "POST" -and $path -eq "/api/items") {
        $body = Read-BodyJson $Request
        $items = @()
        foreach ($item in @($body.items)) {
            $items += [pscustomobject]@{
                id = $(if ($item.id) { $item.id } else { [guid]::NewGuid().ToString() })
                name = Clean-Text $item.name
                query = Clean-Text $(if ($item.query) { $item.query } else { $item.name })
                quantity = [double]$(if ($item.quantity) { $item.quantity } else { 1 })
                category = Clean-Text $item.category
                targetSize = Clean-Text $(if ($item.PSObject.Properties.Name -contains "targetSize") { $item.targetSize } else { "" })
                links = $(Normalize-ItemLinks $item.links)
            }
        }
        Write-JsonFile $ItemsFile $items
        return New-JsonResponse @{ ok = $true; items = [object[]]$items }
    }
    if ($Request.method -eq "POST" -and $path -eq "/api/settings") {
        $settings = Read-JsonFile $SettingsFile $DefaultSettings
        $incoming = (Read-BodyJson $Request).settings
        foreach ($prop in $incoming.PSObject.Properties) { $settings | Add-Member -Force NoteProperty $prop.Name $prop.Value }
        Write-JsonFile $SettingsFile $settings
        return New-JsonResponse @{ ok = $true; settings = $settings }
    }
    if ($Request.method -eq "POST" -and $path -eq "/api/scan") {
        return New-JsonResponse (Run-Scan)
    }
    if ($Request.method -eq "POST" -and $path -eq "/api/scan/catalogue") {
        return New-JsonResponse (Run-CatalogueScan)
    }
    if ($Request.method -eq "POST" -and $path -eq "/api/scan/start") {
        return New-JsonResponse @{ ok = $true; job = (Start-ScanJob) }
    }

    if ($path -eq "/") { $path = "/index.html" }
    $relative = [Uri]::UnescapeDataString($path.TrimStart("/")).Replace("/", [IO.Path]::DirectorySeparatorChar)
    $filePath = Join-Path $WebDir $relative
    return New-FileResponse $filePath
}

function Parse-QueryString($Value) {
    $params = @{}
    if ([string]::IsNullOrWhiteSpace($Value)) { return $params }
    foreach ($pair in $Value.TrimStart("?").Split("&")) {
        if ([string]::IsNullOrWhiteSpace($pair)) { continue }
        $idx = $pair.IndexOf("=")
        if ($idx -ge 0) {
            $key = [Uri]::UnescapeDataString($pair.Substring(0, $idx).Replace("+", " "))
            $val = [Uri]::UnescapeDataString($pair.Substring($idx + 1).Replace("+", " "))
        } else {
            $key = [Uri]::UnescapeDataString($pair.Replace("+", " "))
            $val = ""
        }
        if ($key) { $params[$key] = $val }
    }
    return $params
}

function Read-HttpRequest($Client) {
    $stream = $Client.GetStream()
    $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::UTF8, $false, 8192, $true)
    $requestLine = $reader.ReadLine()
    if ([string]::IsNullOrWhiteSpace($requestLine)) { return $null }
    $parts = $requestLine.Split(" ")
    $headers = @{}
    while ($true) {
        $line = $reader.ReadLine()
        if ($null -eq $line -or $line -eq "") { break }
        $idx = $line.IndexOf(":")
        if ($idx -gt 0) {
            $headers[$line.Substring(0, $idx).Trim().ToLowerInvariant()] = $line.Substring($idx + 1).Trim()
        }
    }
    $body = ""
    if ($headers.ContainsKey("content-length")) {
        $length = [int]$headers["content-length"]
        if ($length -gt 0) {
            $buffer = New-Object char[] $length
            $read = $reader.Read($buffer, 0, $length)
            $body = -join $buffer[0..($read - 1)]
        }
    }
    $path = $parts[1]
    $query = @{}
    $queryIndex = $path.IndexOf("?")
    if ($queryIndex -ge 0) {
        $query = Parse-QueryString $path.Substring($queryIndex + 1)
        $path = $path.Substring(0, $queryIndex)
    }
    return @{
        method = $parts[0]
        path = $path
        query = $query
        headers = $headers
        body = $body
        stream = $stream
    }
}

function Write-HttpResponse($Stream, $Response) {
    $reason = switch ($Response.status) {
        200 { "OK" }
        404 { "Not Found" }
        500 { "Internal Server Error" }
        default { "OK" }
    }
    $header = "HTTP/1.1 $($Response.status) $reason`r`nContent-Type: $($Response.contentType)`r`nContent-Length: $($Response.body.Length)`r`nConnection: close`r`n`r`n"
    $headerBytes = [Text.Encoding]::ASCII.GetBytes($header)
    $Stream.Write($headerBytes, 0, $headerBytes.Length)
    $Stream.Write($Response.body, 0, $Response.body.Length)
}

if ($env:GPC_IMPORT_ONLY -ne "1") {
    Ensure-Files
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse($HostName), $Port)
    $listener.Start()
    Write-Host "South Africa Grocery Price Checker running at http://127.0.0.1`:$Port"
    Write-Host "Phone on same Wi-Fi: $(Get-LanUrl)"
    Write-Host "Press Ctrl+C to stop."

    try {
        while ($true) {
            $client = $listener.AcceptTcpClient()
            try {
                $request = Read-HttpRequest $client
                if ($null -ne $request) {
                    try {
                        $response = Route-Request $request
                    } catch {
                        $response = New-JsonResponse @{ ok = $false; error = $_.Exception.Message } 500
                    }
                    Write-HttpResponse $request.stream $response
                }
            } catch {
                Write-Host $_.Exception.Message
            } finally {
                $client.Close()
            }
        }
    } finally {
        $listener.Stop()
    }
}
