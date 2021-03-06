The API is built to allow you to create apps or integrations quickly and easily.

This API is organized around REST principles, so if you've interacted with RESTful APIs before, many of the concepts will look familiar.

## Request
* Requests with a message body use JSON. Successful requests will return a `2xx` HTTP status.

## Response

* JSON will be returned for all responses, including errors.

## Parameters

* Some endpoints accept optional parameters which can be passed as query string params. 
* All parameters are documented along each endpoint.

## Fields

* In order to fetch only specific fields from the response, the `fields` parameter can be used:
    * `/accounts?fields=address,balance for arrays`
    * `/economics?fields=price,marketCap for object`

## Extract
* In order to extract a scalar value from an object response, the `extract` parameter can be used:
    * `/economics?extract=price`

## Cleanup
* If the value of an attribute is `undefined`, `""` (empty string), `null`, `[ ]` (empty array) the attribute will be omitted.

## Pagination

* Requests that return multiple items will be paginated to 25 items by default. 
* For a different number of items or for the next pages `?from=` and `size=` can be used.
