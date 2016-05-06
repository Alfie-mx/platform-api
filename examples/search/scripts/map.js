var map = {};

(function () {


var token;
var venueId;

// We will be using MappedIn API V1
var host = {
	auth: 'https://auth-staging.mappedin.com',
	api: 'https://api-staging.mappedin.com/1/'
}

// We will be using the Leaflet (http://leafletjs.com/) map library to render the MappedIn Map and data.
// You are free to choose any other Map Rendering library for your web based projects
var leaflet = {
	map: null,
	layers: {},
	maxBounds: null
};

// We will be rendering the 'MappedIn Mall' venue for this demo

var maps = {};
var projective;
var map = null;
var perspective;
var tileLayer = null;
var cache = {
	locations: []
};
var categoryId;
var defaultZoom = 2;
var markerLayerGroup = L.LayerGroup.collision({margin:0})

// Special value that means to show every location in the "category" dropdown
var ALL_LOCATIONS = "ALL"

// Predefined styles used to create hover effects and highlight polygons
// Feel free to add your own and use them in highlightPoygon, or change
// the existing ones.
var polygonStyles = {
	invisible: {
		fillOpacity: 0.0,
		stroke: false
	},
	hover: {
		fillOpacity: 0.5,
		fillColor: "white",
		stroke: true,
		color: "white",
		opacity: 1.0,
		lineJoin: "miter",
		weight: 3
	},
	highlight: {
		fillOpacity: 0.5,
		fillColor: "blue",
		stroke: true,
		color: "white",
		opacity: 1.0,
		lineJoin: "miter",
		weight: 3
	}
}

// Auth
/**
* Our authentication function for requesting an OAuth token from the MappedIn server.
* We will need this token for requesting any data from our API.
*
* Note: A MappedIn token expires after 24 hours. You should setup your code in your production
* environment to be able to renew or request a new token before it expires
**/
function authenticate(grant, cb) {
	$.ajax({
		url: host.auth + '/oauth2/token',
		data: grant,
		type: 'POST',
		success: function (result) {
			token = result;
			cb();
		},
		error: function (result) {
			console.log("Error Authenticating.")
		}
	});
};

// Our main API object for requesting data from MappedIn
var api = {
	/**
	* A simple jQuery AJAX call to request the various type of data that the MappedIn web API is able to provide
	* Please consult the MappedIn API Reference doc at https://github.com/MappedIn/platform-api/blob/master/v1.md
	* for more information on the different parameters and calls you are allowed to make using the MappedIn API
	**/
	Get: function (asset, data, cb) {
		var objects;
		function getObjects(url, cb) {
			$.ajax({
				url: url,
				type: 'GET',
				// Remember to include the OAuth token with every API request with MappedIn servers
				beforeSend: function (xhr) {
					xhr.setRequestHeader("Authorization", token.token_type + ' ' + token.access_token);
				},
				success: cb
			});
		}
		// Note: this function is for illustration purposes only. It is not robust
		// and it assumes absolute URLs.
		function getNextLink(headerValue) {
			var links = headerValue.split(',');
			for (var i = 0, len = links.length; i < len; ++i) {
				var link = links[i];
				if (link.indexOf('rel="next"') !== -1) {
					return link.slice(link.indexOf('<') + 1, link.indexOf('>'));
				}
			}
		}
		function handleResponse(data, statusText, xhr) {
			if (Array.isArray(data) && Array.isArray(objects)) {
				for (var i = 0, len = data.length; i < len; ++i) {
					objects.push(data[i]);
				}
			} else {
				objects = data;
			}
			var linkHeader = xhr.getResponseHeader('Link');
			if (linkHeader) {
				var nextLink = getNextLink(linkHeader);
				if (nextLink) {
					return getObjects(nextLink, handleResponse);
				}
			}
			cb(objects, statusText, xhr);
		}
		var url = host.api + asset;
		if (data) {
			url += '?' + $.param(data);
		}
		getObjects(url, handleResponse);
	}
};

/**
* Simple initialization function to get the map data for our current venue and start the map loading process
**/
this.init = function (venue, perspectiveName, tk, cb) {
	token = tk;
	venueId = venue;

	api.Get('map', { venue: venueId }, function (results) {
		// Getting the first map returned by MappedIn API
		results.forEach(function(map){
			maps[map.id] = map;
		});

		map = results[0];

		// Getting the first perspective that belongs to this map
		perspective = map.perspectives[0];

		// Initializing the leaflet map
		//initProjective(perspective); //redundant?
		changeMap(perspectiveName);


		_.sortBy(maps, 'elevation').forEach(function(map){
			initFloor(map, perspectiveName);
		});
		cb();
	});
}

/**
* Initialize the map for use
*/
function initMap (tiles) {
	$('#map').empty();

	// Prepare tiles URL for use in Leaflet
	var	url = tiles + ((tiles.substr(tiles.length-1, 1) !== '/') ? '/' : '') + "{z}/{x}_{y}.png";

	// Here we are calculating the maximum zoom level available for our currently select map perspective.
	// The maximum zoom level is same as the maximum tile layer {z} available from our servers.
	var maxZoom = Math.ceil(Math.log((Math.max(perspective.size.height, perspective.size.width)))/Math.log(2)) - 8;
	tileLayer = new L.tileLayer(url, {
		zoomOffset: 8,
		zoom: defaultZoom,
		minZoom: 0,
		maxZoom: maxZoom,
		noWrap: true,
		continuousWorld: true
	})

	// Setting up the Leaflet map layers
	leaflet.map = L.map('map', {
		crs: L.CRS.Simple,
		zoom: 0,
		minZoom: 0,
		maxZoom: maxZoom,
		center: [0,0]
	}).addLayer(tileLayer);

	leaflet.map.setZoom(defaultZoom);

	// Setting up the max bounds for the map since our venue is not as big as the world
	leaflet.maxBounds = getMaxBounds();
	leaflet.map.setMaxBounds(leaflet.maxBounds);

}

/**
* This is our main function for initializing and changing the Leaflet map.
* Here we tell Leaflet the URL for the map tiles to load and display.
* We also tell Leaflet how much it should allow a user to scroll and pan the map.
*
* NOTE: As previously mentioned, you can use MappedIn API with any other map library that can display
* custom map tiles. Using Leaflet in your web projects is not required to be able to use MappedIn API.
**/
function changeMap(perspectiveName) {

	clearLocationMarkers();

	leaflet.layers={};

	var perspectiveIndex = _.findIndex(maps[map.id].perspectives, function(item){
			return item.name == perspectiveName;
		})

	perspective = maps[map.id].perspectives[perspectiveIndex];

	initProjective(perspective);

	var tiles = perspective.tiles || perspective.image;

	if (tileLayer) {
		leaflet.map.removeLayer(tileLayer);
	}

	if (leaflet.map) {
		leaflet.map.remove();
	}

	// Prepare tiles URL for use in Leaflet
	var	url = tiles + ((tiles.substr(tiles.length-1, 1) !== '/') ? '/' : '') + "{z}/{x}_{y}.png";

	// Here we are calculating the maximum zoom level available for our currently select map perspective.
	// The maximum zoom level is same as the maximum tile layer {z} available from our servers.
	var maxZoom = Math.ceil(Math.log((Math.max(perspective.size.height, perspective.size.width)))/Math.log(2)) - 8;

	tileLayer = new L.tileLayer(url, {
		zoomOffset: 8,
		zoom: defaultZoom,
		minZoom: 0,
		maxZoom: maxZoom,
		noWrap: true,
		continuousWorld: true
	})

	leaflet.map = L.map('map', {
		crs: L.CRS.Simple,
		zoom: 0,
		minZoom: 0,
		maxZoom: maxZoom,
		center: [0,0]
	}).addLayer(tileLayer);
	leaflet.map.setZoom(defaultZoom);


	// Setting up the max bounds for the map since our venue is not as bug as the world
	leaflet.maxBounds = getMaxBounds();
	leaflet.map.setMaxBounds(leaflet.maxBounds);
	leaflet.map.fitWorld();

	getModelData(function(){
		initMapInteraction();
		changeCategoryById(categoryId);

		// Create the base highlight polygons for all polygons on a location
		for (var i = 0; i < cache.locations.length; i++) {
			var location = cache.locations[i]

			for (var j = 0; j < location.polygons.length; j++) {
				var polyData =  cache.polygons[location.polygons[j].id]
				if (polyData.map == map.id && (polyData._locations == null || polyData._locations[location.id] == null)) {
					var polygon = createPolygon(polyData)
					leaflet.map.addLayer(polygon)
					polyData._locations[location.id] = location

					createLabelMarker(location, polyData)
				}
			}

		}
	});
}

/**
* Initalizes a floor for use
*/
function initFloor(myMap, perspectiveName) {
	var floorsDiv = $('#floors');
	var index = _.findIndex(myMap.perspectives, function(item){
		return item.name == perspectiveName;
	})


	var floor = '<div class="col-md-4 floor" id="floor_' + myMap.id +'"><div class="row floor-name">' + myMap.name + '</div><div class="row floor-image" style="background-image: url(' + myMap.perspectives[index].original+ ')"></div></div>';
	floorsDiv.append(floor);

	$("#floor_" + myMap.id).on('click', function(e){
		map = maps[myMap.id];
		changeMap(perspectiveName);

	});

}

/**
* Here we are creating a matrix for doing projective transformation calculations using the
* Projective object from the Projective.js file.
*
* Matrix transformation are needed when the venue map you want to display in your web page has been
* transformed, like rotated, skewed or resized in MappedIn Portal. When this occurs, all node data
* returned from the server also has to be transformed to properly match the co-ordinates on the
* transformed map, since the server by default will return data for the base map only.
**/
function initProjective (perspective) {
	var control = [],
		target = [];
	perspective.reference.forEach(function (pr) {
		control.push([parseFloat(pr.control.x),parseFloat(pr.control.y)]);
		target.push([parseFloat(pr.target.x),parseFloat(pr.target.y)]);
	});
	projective = new Projective({ from: control, to: target });
}

/**
* Here we are getting all the data necessary to make our demo map work properly.
* We are getting all locations and nodes that belong in this venue, and caching them in our 'cache' object.
* We are also getting the different categories available for this venue and building a radio button list
* to show how to display markers on the map for different types of locations.
**/
function getModelData(cb) {
	cache = {
		locations: [],
		locationsById: {}
	};

	// Getting all locations for our venue.
	// You can also get all the location with the node objects inserted within my by passing 'embed' parameter like so:
	// api.Get('location', { venue: venueId, embed: 'nodes' }, function (locations) { ... });
	api.Get('location', { venue: venueId, embed: 'nodes' }, function (locations) {

		// Get all polygons on the venue defined in Portal (ie, the building blocks of the map used to create the 3D model/map perspectives)
		api.Get('polygon', {venue: venueId}, function (polygons) {
			// Caching all of our locations
			cache.locations = locations;
			cache.locationsById = _.indexBy(locations, 'id');

			// Getting all categories that have been defined for this venue in the MappedIn portal
			api.Get('category', { venue: venueId }, function (categories) {

				// Caching all of our polygons
				cache.polygons = {};
				for (var i = 0; i < polygons.length; i++) {
					// Set up some internal data for polygons to use
					polygons[i]["_highlighted"] = false
					polygons[i]["_locations"] = {}
					polygons[i]["_markers"] = {}
					cache.polygons[polygons[i].id] = polygons[i]
				}

				// Dynamically creating a dropdown for you to switch between different
				// category marker layers in Leaflet

				var categoryListDiv = $('#category-list');
				categoryListDiv.empty();

				// Make a special option to show all locations
				var link = $('<a/>', {
					role: "menuitem",
					tabindex:"-1",
					text: ALL_LOCATIONS,
					href: "#",
					value: ALL_LOCATIONS,
					click: function(e){
						categoryId = $(this).attr("value");
						changeCategoryById(categoryId);
						$('#categoriesDropdown').html($(this).text() + ' <span class="caret"></span>');
						return true;
					}
				});
				var listItem = $('<li/>', { role: "presentation", html: link});
				categoryListDiv.append(listItem);

				// Make an option to show all locations in each category
				for (var i = 0; i < categories.length; i++) {
					var link = $('<a/>', {
						role: "menuitem",
						tabindex:"-1",
						text:categories[i].name,
						href: "#",
						value: categories[i].id,
						click: function(e){
							categoryId = $(this).attr("value");
							changeCategoryById(categoryId);
							$('#categoriesDropdown').html($(this).text() + ' <span class="caret"></span>');
							return true;
						}
					});

					var listItem = $('<li/>', { role: "presentation", html: link});
					categoryListDiv.append(listItem);
				}



				return cb();
			});


		});

	});
}

/**
*  This function removeds all location markers from the map
**/
function clearLocationMarkers() {
	markerLayerGroup.clearLayers()
	Object.keys(leaflet.layers).forEach(function (layer) {
		leaflet.map.removeLayer(leaflet.layers[layer]);
	});
}
/**
 * A simple icon extding DivIcon that doesn't set the margin/size,
 * which made it difficult to center text labels on their markers. Use
 * this with a CSS class like localtion-label.
 */
L.FillIcon = L.DivIcon.extend({
	options: {
		iconSize: [12, 12], // also can be set through CSS
		className: 'leaflet-div-icon',
		html: false
	},
	_setIconStyles: function (img, name) {

		var options = this.options,
		size = L.point(options[name + 'Size']),
		anchor;


		if (name === 'shadow') {
			anchor = L.point(options.shadowAnchor || options.iconAnchor);
		} else {
			anchor = L.point(options.iconAnchor);
		}

		if (!anchor && size) {
			anchor = size.divideBy(2, true);
		}

		img.className = 'leaflet-marker-' + name + ' ' + options.className;

		// if (anchor) {
		// 	img.style.marginLeft = (-anchor.x) + 'px';
		// 	img.style.marginTop  = (-anchor.y) + 'px';
		// }

		// if (size) {
		// 	img.style.width  = size.x + 'px';
		// 	img.style.height = size.y + 'px';
		// }

	}
});

L.fillIcon = function (options) {
	return new L.FillIcon(options);
};


function createLabelMarker(location, polyData) {

	// Place labels in the true center of the polygons
	var coordinates = getCentroid(polyData.polygon);
	//console.log(coordinates)
	var locationIcon = L.fillIcon({className: '', html: "<div class='location-label'>" + location.name + "</div>"});
	var marker = L.marker(coordinates, {icon: locationIcon});

	marker.mLocation = location;
	marker.mPolygon = polyData.id;
	marker.on("click", onLabelMarkerClick)

	polyData._markers[location.id] = marker

}

/**
* This function contains sample code to show how to setup click events on a Leaflet map and markers.
**/
function initMapInteraction() {

	// Clear the map if we click on nothing
	leaflet.map.on('click', function () {
		clearLocationProfile()
		clearHighlightPolygons()
		clearLocationMarkers()
	});
}

/**
* This function sets a polygon to a certain visual style that won't be overridden by the mouseover effect.
* Remove it with the clearHighlightPolygons function. Used mostly on mouse click, but you could highlight
* things with your own styles for other reasons.
*/
function highlightPolygon(id, style) {
	var polyData = cache.polygons[id]
	var polygon = polyData.polygon
	polyData._highlighted = true
	polygon.setStyle(style)

}

this.locationHasPolygons = function (locationId) {
	var location = cache.locationsById[locationId];
	if (!location || !location.polygons) return false;
	if (location.polygons.length > 0) {
		return true;
	}
	return false;
}

this.highlightLocation = function (locationId) {

	var location = cache.locationsById[locationId];
	if (!location || !location.polygons) return;

	location.polygons.forEach(function (polygon) {
		highlightPolygon(polygon.id, polygonStyles.highlight);
		var polyData = cache.polygons[polygon.id]

		var center = getCentroid(polyData.polygon)
		//leaflet.map.setZoom(4);
		leaflet.map.setView(center, 2);

		//leaflet.map.panTo(new L.LatLng(center[0], center[1]));
	});

}

/**
* Takes MappedIn Polygon data creates the corrisponding Leaflet polygon in the map's frame of reference.
* Each MappedIn polygon should only have one Leaflet polygon. Use highlightPolygon to change the styles.
*/
function createPolygon(polyData) {
	var vertexes = []
	for (var j = 0; j < polyData.vertexes.length; j++) {
		var vert = leaflet.map.unproject(projective.transform([polyData.vertexes[j].x, polyData.vertexes[j].y]), leaflet.map.getMaxZoom())
		vertexes.push(vert)
	}
	var polygon = L.polygon(vertexes, {color: "white", stroke: false, fillOpacity: 0.0})
	polyData["polygon"] = polygon
	polygon["mId"] = polyData.id

	polygon.on("mouseover", onPolygonMouseover)
	polygon.on("mouseout", onPolygonMouseout)
	polygon.on("click", onPolygonClick)
	return polygon
}

/**
* Give a subtle hover effect when the mouse goes over a polygon
*/
function onPolygonMouseover(event) {
	var polygonData = cache.polygons[event.target.mId]
	if (!polygonData._highlighted) {
		event.target.setStyle(polygonStyles.hover)
	}
}

/**
* If we were hovering over a polygon, turn off the highlight when the mouse leaves.
*/
function onPolygonMouseout(event) {
	var polygonData = cache.polygons[event.target.mId]
	if (!polygonData._highlighted) {
		event.target.setStyle(polygonStyles.invisible)
	}
}

/**
* Handle clicking on a polygon by highlighting it and displaying the location's information
*/
function onPolygonClick(event) {
	clearHighlightPolygons()
	var polygonData = cache.polygons[event.target.mId]
	highlightPolygon(event.target.mId, polygonStyles.highlight)
	var keys = Object.keys(polygonData._locations)
	if (keys.length > 0) {
		// If your venue has multiple polygons with multiple locations, it's up to you to determine
		// which location a user is interested in when they click on a polygon.
		// Otherwise, they will always want the first (and only) one
		showLocationProfile(polygonData._locations[keys[0]])
	}
}

/**
* Handle the user clicking on a label marker for a specific location by behaving as though the polygon
* for that location was clicked on.
*/
function onLabelMarkerClick(event) {
	clearHighlightPolygons()

	showLocationProfile(event.target.mLocation)
	highlightPolygon(event.target.mPolygon, polygonStyles.highlight)

	clearLocationMarkers()
}

/**
* Clears the highlight effect from all polygons.
*/
function clearHighlightPolygons() {
	for (id in cache.polygons) {
		var polyData = cache.polygons[id]
		if (polyData._highlighted = true && polyData.polygon) {
			polyData._highlighted = false
			polyData.polygon.setStyle(polygonStyles.invisible)
		}
	}
}

this.clearHighlightPolygons = clearHighlightPolygons;


/**
* This function looks at all logo image sizes and determines which size to use.
**/
function getLogoURL(logo) {
	return logo.small || logo['140x140'] || logo.xsmall || logo['66x66'] || logo.original;
}

/**
* Displays the information for a given location at the bottom of the page
*/
function showLocationProfile(location) {
	var locationProfileDiv = $('#location-profile');
	locationProfileDiv.removeClass('fade-in');

	setTimeout(function(){

		locationProfileDiv.empty();

		if (location.logo) {
			locationProfileDiv.append('<div class="col-md-4 col-md-offset-2 location-logo" style="background-color: '+ location.color.rgba +'; background-image: url('+getLogoURL(location.logo) + ')"></div>');
		} else {
			locationProfileDiv.append('<div class="col-md-4 col-md-offset-2 location-logo" ></div>');
		}

		locationProfileDiv.append('<div class="col-md-6"><div class="row"><div class="row location-name">' + location.name + '</div><div class="row location-description">' + (location.description ? location.description : "") + '</div></div></div>');
		locationProfileDiv.addClass('fade-in');
	}, 500);
}

/**
* Clears any previously displayed location information
*/
function clearLocationProfile() {
	var locationProfileDiv = $('#location-profile');
	locationProfileDiv.removeClass('fade-in');
}

/**
* Function to quickly switch between different category marker layers in Leaflet
**/
function changeCategoryById(id) {
	clearLocationMarkers();
	clearHighlightPolygons();
	clearLocationProfile();

	// Add markers for all locations in the relevant categories to our markerLayerGroup
	for (i = 0; i < cache.locations.length; i++) {
		var location = cache.locations[i]
		if (((id == ALL_LOCATIONS && location.categories.length > 0) || location.categories.indexOf(id) > -1)) {
			for (var j = 0; j < location.polygons.length; j ++) {

				// Retrieve the existing marker
				var polyData = cache.polygons[location.polygons[j].id]
				var marker = polyData._markers[location.id]

				markerLayerGroup.addLayer(marker)
			}
		}
	}
	leaflet.map.addLayer(markerLayerGroup);
}

/**
* A simple implementation that shows how to transform direction path co-ordinates and
* then draw a path in Leaflet to show directions from the 'start' node to the 'end' node
**/
function drawDirections(venueId, start, end) {
	// Calling API to get the direction from 'start' to 'end' nodes
	api.Get('directions', { venue: venueId, origin: start, destination: end }, function (directions) {
		var path = [];

		// Processing all the nodes for the 'path' of the directions object into
		// co-ordinates that can be used by Leaflet to draw a directions line on the map
		for (var i = 0; i < directions.path.length; i++) {
			var coords = projective.transform([directions.path[i].x, directions.path[i].y]);
			var latlng = leaflet.map.unproject(coords, leaflet.map.getMaxZoom());
			path.push(latlng);
		}

		// Making Leaflet draw a red lines showing the path to take from
		// the 'start' node to the 'end' node
		leaflet.map.addLayer(new L.polyline(path, { color: '#ff0000', opacity: 0.7 }));
	});
}

/**
* Simple utility function to calculate the maximum scroll bounds for our map so Leaflet
* does not scroll outside the map bounds
**/
function getMaxBounds() {
	var southWest = leaflet.map.unproject([0, perspective.size.height], leaflet.map.getMaxZoom());
	var northEast = leaflet.map.unproject([perspective.size.width, 0], leaflet.map.getMaxZoom());
	return new L.LatLngBounds(southWest, northEast);
}


// Polygon centroid algorithm from http://stackoverflow.com/a/22796806/2283791
function getCentroid (polygon) {
    var twoTimesSignedArea = 0;
    var cxTimes6SignedArea = 0;
    var cyTimes6SignedArea = 0;

    //console.log("Getting lat/langs of")

    var points = polygon.getLatLngs()
	//console.log(points)
    var length = points.length

    var x = function (i) { return points[i % length].lat };
    var y = function (i) { return points[i % length].lng };

    for ( var i = 0; i < length; i++) {
        var twoSA = x(i)*y(i+1) - x(i+1)*y(i);
        twoTimesSignedArea += twoSA;
        cxTimes6SignedArea += (x(i) + x(i+1)) * twoSA;
        cyTimes6SignedArea += (y(i) + y(i+1)) * twoSA;
    }
    var sixSignedArea = 3 * twoTimesSignedArea;
    return [ cxTimes6SignedArea / sixSignedArea, cyTimes6SignedArea / sixSignedArea];
}


}).apply(map);
