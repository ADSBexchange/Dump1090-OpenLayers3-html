"use strict";

function PlaneObject(icao) {
	// Info about the plane
        this.icao      = icao;
        this.icaorange = findICAORange(icao);
        this.flight    = null;
	this.squawk    = null;
	this.selected  = false;
        this.category  = null;

	// Basic location information
        this.altitude  = null;
        this.speed     = null;
        this.track     = null;
        this.prev_position = null;
        this.position  = null;
        this.position_from_mlat = false
        this.sitedist  = null;

	// Data packet numbers
	this.messages  = null;
        this.rssi      = null;

        // Track history as a series of line segments
        this.elastic_feature = null;
        this.track_linesegs = [];
        this.history_size = 0;

	// When was this last updated (receiver timestamp)
        this.last_message_time = null;
        this.last_position_time = null;

        // When was this last updated (seconds before last update)
        this.seen = null;
        this.seen_pos = null;

        // Display info
        this.visible = true;
        this.marker = null;
        this.markerStyle = null;
        this.markerIcon = null;
        this.markerStaticStyle = null;
        this.markerStaticIcon = null;
        this.markerStyleKey = null;
        this.markerSvgKey = null;
        this.filter = {};

	// Akissack - additional variables for various modifications - Ref: AK9Z Start
	this.is_vetted      = false ;
	this.is_interesting = '' ;  // 'Y' or not
	this.my_vet	    = '' ;  // 1 = Mil/noTrail 2 = Civ/noTrail 5 = Mil/Trail 6 = Civ/Trail 0 = ?/noTrail 3,4,7 = ERR
	this.my_trail	    = '' ;  // trail on by default
	this.ac_type        = '' ;  // icao type
	this.ac_shortname   = '' ;  // Short a/c name
	this.ac_aircraft    = '' ;   // Long a/c name
        this.ac_category    = '';   // My category for images -  eg 2prop
	this.country	    = '';
	this.operator       = '';
	// Akissack - additional variables for various modifications - Ref: AK9Z Ends

        // start from a computed registration, let the DB override it
        // if it has something else.
        this.registration = registration_from_hexid(this.icao);
        this.icaotype = null;
        this.typeDescription = null;
        this.wtc = null;

        // request metadata
        getAircraftData(this.icao).done(function(data) {
                if ("r" in data) {
                        this.registration = data.r;
                }

                if ("t" in data) {
                        this.icaotype = data.t;
                }

                if ("desc" in data) {
                        this.typeDescription = data.desc;
                }

                if ("wtc" in data) {
                        this.wtc = data.wtc;
                }
		// -------------------------------------------------
		// AKISSACK - Load my details from json ------Ref: AK9E starts
		// -------------------------------------------------
		if (ShowMyPreferences && ShowAdditionalData) {
		  if (this.icao.substring(0,3) == '43c' || this.icao.substring(0,2) == 'ae' ) {this.is_interesting = 'Y';}
		  if ("Int" in data) {
		    if (data.Int == 1) this.is_interesting = 'Y';
		  }
		  if ("Trail" in data) {
		     if (data.Trail == 5  || data.Trail == 6) {this.my_trail = true;}
		  }
		  if ("Country" in data) {this.country = data.Country;}
		  if ("Owner" in data)   {this.operator = data.Owner;}
		  if ("Force" in data)   {this.operator = data.Force;}
		  if ("Image" in data)   {this.ac_category = data.Image;}
		  if ("Short" in data)   {this.ac_shortname = data.Short;}
		  if ("Type" in data)    {this.ac_aircraft = data.Type;}
		}
		// -------------------------------------------------
		// -------------------------------------- Ref: AK9E ends
		// -------------------------------------------------
                if (this.selected) {
		        refreshSelected();
                }
        }.bind(this));
}

PlaneObject.prototype.isFiltered = function() {
    if (this.filter.minAltitude !== undefined && this.filter.maxAltitude !== undefined) {
        if (this.altitude === null || this.altitude === undefined) {
            return true;
        }
        var planeAltitude = this.altitude === "ground" ? 0 : convert_altitude(this.altitude, this.filter.altitudeUnits);
        return planeAltitude < this.filter.minAltitude || planeAltitude > this.filter.maxAltitude;
    }

    return false;
}

// Appends data to the running track so we can get a visual tail on the plane
// Only useful for a long running browser session.
PlaneObject.prototype.updateTrack = function(estimate_time) {
        if (!this.position)
                return false;
        if (this.position == this.prev_position)
                return false;

        var projHere = ol.proj.fromLonLat(this.position);
        var projPrev;
        if (this.prev_position === null) {
                projPrev = projHere;
        } else {
                projPrev = ol.proj.fromLonLat(this.prev_position);
        }

        this.prev_position = this.position;

        if (this.track_linesegs.length == 0) {
                // Brand new track
                //console.log(this.icao + " new track");
                var newseg = { fixed: new ol.geom.LineString([projHere]),
                               feature: null,
                               head_update: this.last_position_time,
                               tail_update: this.last_position_time,
                               estimated: false,
                               ground: (this.altitude === "ground")
                             };
                this.track_linesegs.push(newseg);
                this.history_size ++;
                return;
        }

        var lastseg = this.track_linesegs[this.track_linesegs.length - 1];
        var elapsed = (this.last_position_time - lastseg.head_update);
        
        var est_track = (elapsed > estimate_time);
        var ground_track = (this.altitude === "ground");
        
        if (est_track) {

                if (!lastseg.estimated) {
                        // >5s gap in data, create a new estimated segment
                        //console.log(this.icao + " switching to estimated");
                        lastseg.fixed.appendCoordinate(projPrev);
                        this.track_linesegs.push({ fixed: new ol.geom.LineString([projPrev, projHere]),
                                                   feature: null,
                                                   head_update: this.last_position_time,
                                                   estimated: true });
                        this.history_size += 2;
                } else {
                        // Keep appending to the existing dashed line; keep every point
                        lastseg.fixed.appendCoordinate(projPrev);
                        lastseg.head_update = this.last_position_time;
                        this.history_size++;
                }

                return true;
        }
        
        if (lastseg.estimated) {
                // We are back to good data (we got two points close in time), switch back to
                // solid lines.
                lastseg = { fixed: new ol.geom.LineString([projPrev]),
                            feature: null,
                            head_update: this.last_position_time,
                            tail_update: this.last_position_time,
                            estimated: false,
                            ground: (this.altitude === "ground") };
                this.track_linesegs.push(lastseg);
                this.history_size ++;
                // continue
        }
        
        if ( (lastseg.ground && this.altitude !== "ground") ||
             (!lastseg.ground && this.altitude === "ground") ) {
                //console.log(this.icao + " ground state changed");
                // Create a new segment as the ground state changed.
                // assume the state changed halfway between the two points
                // FIXME needs reimplementing post-google

                lastseg.fixed.appendCoordinate(projPrev);
                this.track_linesegs.push({ fixed: new ol.geom.LineString([projPrev, projHere]),
                                           feature: null,
                                           head_update: this.last_position_time,
                                           tail_update: this.last_position_time,
                                           estimated: false,
                                           ground: (this.altitude === "ground") });
                this.history_size += 3;
                return true;
        }
        
        // Add more data to the existing track.
        // We only retain some historical points, at 5+ second intervals,
        // plus the most recent point
        if (this.last_position_time - lastseg.tail_update >= 5) {
                // enough time has elapsed; retain the last point and add a new one
                //console.log(this.icao + " retain last point");
                lastseg.fixed.appendCoordinate(projHere);
                lastseg.tail_update = lastseg.head_update;
                this.history_size ++;
        }

        lastseg.head_update = this.last_position_time;
        return true;
};

// This is to remove the line from the screen if we deselect the plane
PlaneObject.prototype.clearLines = function() {
        for (var i = this.track_linesegs.length - 1; i >= 0 ; --i) {
                var seg = this.track_linesegs[i];
                if (seg.feature !== null) {
                        PlaneTrailFeatures.remove(seg.feature);
                        seg.feature = null;
                }
        }

        if (this.elastic_feature !== null) {
                PlaneTrailFeatures.remove(this.elastic_feature);
                this.elastic_feature = null;
        }
};

PlaneObject.prototype.getDataSource = function() {
    // MLAT
    if (this.position_from_mlat) {
        return 'mlat';
    }

    // Not MLAT, but position reported - ADSB or variants
    if (this.position !== null) {
        return this.addrtype;
    }

    // Otherwise Mode S
    return 'mode_s';

    // TODO: add support for Mode A/C
};

PlaneObject.prototype.getMarkerColor = function() {
        // Emergency squawks override everything else
        if (this.squawk in SpecialSquawks)
                return SpecialSquawks[this.squawk].markerColor;

        var h, s, l;

        if (this.altitude === null) {
                h = ColorByAlt.unknown.h;
                s = ColorByAlt.unknown.s;
                l = ColorByAlt.unknown.l;
        } else if (this.altitude === "ground") {
                h = ColorByAlt.ground.h;
                s = ColorByAlt.ground.s;
                l = ColorByAlt.ground.l;
        } else {
                s = ColorByAlt.air.s;
                l = ColorByAlt.air.l;

                // find the pair of points the current altitude lies between,
                // and interpolate the hue between those points
                var hpoints = ColorByAlt.air.h;
                h = hpoints[0].val;
                for (var i = hpoints.length-1; i >= 0; --i) {
                        if (this.altitude > hpoints[i].alt) {
                                if (i == hpoints.length-1) {
                                        h = hpoints[i].val;
                                } else {
                                        h = hpoints[i].val + (hpoints[i+1].val - hpoints[i].val) * (this.altitude - hpoints[i].alt) / (hpoints[i+1].alt - hpoints[i].alt)
                                }
                                break;
                        }
                }
        }

        // If we have not seen a recent position update, change color
        if (this.seen_pos > 15) {
                h += ColorByAlt.stale.h;
                s += ColorByAlt.stale.s;
                l += ColorByAlt.stale.l;
        }

        // If this marker is selected, change color
        if (this.selected && !SelectedAllPlanes){
                h += ColorByAlt.selected.h;
                s += ColorByAlt.selected.s;
                l += ColorByAlt.selected.l;
        }

        // If this marker is a mlat position, change color
        if (this.position_from_mlat) {
                h += ColorByAlt.mlat.h;
                s += ColorByAlt.mlat.s;
                l += ColorByAlt.mlat.l;
        }

        if (h < 0) {
                h = (h % 360) + 360;
        } else if (h >= 360) {
                h = h % 360;
        }

        if (s < 5) s = 5;
        else if (s > 95) s = 95;

        if (l < 5) l = 5;
        else if (l > 95) l = 95;

	// ---------------------------   AKISSACK mono colour  Ref: AK9C Start
	if (ShowMyPreferences && ShowSimpleColours) {
            var myColour = '#333399' ;
            if (this.is_interesting) {
               myColour = '#993333' ;
            }
	    return myColour;  
        } else {
           // ---------------------------   AKISSACK mono colour  Ref: AK9C ends
           return 'hsl(' + (h/5).toFixed(0)*5 + ',' + (s/5).toFixed(0)*5 + '%,' + (l/5).toFixed(0)*5 + '%)'
	}
}

PlaneObject.prototype.updateIcon = function() {
        var scaleFactor = Math.max(0.2, Math.min(1.2, 0.15 * Math.pow(1.25, ZoomLvl))).toFixed(1);

        var col = this.getMarkerColor();
        var opacity = 1.0;
        var outline = (this.position_from_mlat ? OutlineMlatColor : OutlineADSBColor);
	var baseMarker = getBaseMarker(this.category, this.icaotype, this.typeDescription, this.wtc);
	if (ShowMyPreferences) { // Ref: AK9D starts
            if (ShowMyIcons) {   // Ref: AK10B starts       
 	        var baseMarker = getMyBaseMarker(this.category, this.icaotype, this.typeDescription, this.wtc, this.ac_category);    
	    } // Ref: AK10B ends      
	    var adjWeight = (this.is_interesting ? 0.5 : 0.5)
            var weight = ((this.selected ? 0.75 : adjWeight ) / baseMarker.scale).toFixed(1);
	    if (this.is_interesting == 'Y') {
	        outline = 'rgb(128, 0, 0)' ;
            }
	} else {
	    var weight = ((this.selected && !SelectedAllPlanes ? 2 : 1) / baseMarker.scale / scaleFactor).toFixed(1);
	} //Ref: AK9D ends

        var rotation = (this.track === null ? 0 : this.track);
        var transparentBorderWidth = (32 / baseMarker.scale / scaleFactor).toFixed(1);

        var svgKey = col + '!' + outline + '!' + baseMarker.key + '!' + weight + "!" + scaleFactor;
        var styleKey = opacity + '!' + rotation;

        if (this.markerStyle === null || this.markerIcon === null || this.markerSvgKey != svgKey) {
                //console.log(this.icao + " new icon and style " + this.markerSvgKey + " -> " + svgKey);

                var icon = new ol.style.Icon({
                        anchor: baseMarker.anchor,
                        anchorXUnits: 'pixels',
                        anchorYUnits: 'pixels',
                        scale: baseMarker.scale * scaleFactor,
                        imgSize: baseMarker.size,
                        src: svgPathToURI(baseMarker.path, baseMarker.size, outline, weight, col, transparentBorderWidth),
                        rotation: (baseMarker.noRotate ? 0 : rotation * Math.PI / 180.0),
                        opacity: opacity,
                        rotateWithView: (baseMarker.noRotate ? false : true)
                });

                if (baseMarker.noRotate) {
                        // the base marker won't be rotated
                        this.markerStaticIcon = icon;
                        this.markerStaticStyle = new ol.style.Style({
                                image: this.markerStaticIcon
                        });

                        // create an arrow that we will rotate around the base marker
                        // to indicate heading

                        var offset = baseMarker.markerRadius * baseMarker.scale + 6;
                        var size = offset * 2;

                        var arrowPath = "M " + offset + ",0 m 4,4 -8,0 4,-4 z";
                        this.markerIcon = new ol.style.Icon({
                                anchor: [offset, offset],
                                anchorXUnits: 'pixels',
                                anchorYUnits: 'pixels',
                                scale: 1.0 * scaleFactor,
                                imgSize: [size, size],
                                src: svgPathToURI(arrowPath, [size, size], outline, 1, outline, 0),
                                rotation: rotation * Math.PI / 180.0,
                                opacity: opacity,
                                rotateWithView: true
                        });
                        this.markerStyle = new ol.style.Style({
                                image: this.markerIcon
                        });
                } else {
                        this.markerIcon = icon;

			// ---------------------------------------------------------------------------------------
			// AKISSACK - PERMANENT LABELS - Part 1 ----------------------------------------- ref: AK7A
			// ---------------------------------------------------------------------------------------
			if (ShowPermanentLabels ) {
			    var labelText = '';
                            this.markerStyle = new ol.style.Style({
         			text: new ol.style.Text({
        		      		text: labelText ,
        		      		fill: new ol.style.Fill({color: 'blue'}),
        		      		stroke: new ol.style.Stroke({color: 'yellow', width: 7}),
                              		textAlign: 'left',
                              		textBaseline: "bottom",
                              		font: 'normal 10px tahoma',
        		      		offsetX: +15,
        		      		offsetY: +30
        			}),
                                image: this.markerIcon
                            });
			} else {
                            this.markerStyle = new ol.style.Style({
                                image: this.markerIcon
                            });
			}
			// ---------------------------------------------------------------------------------------
                       	// ----------------------------------------------------------------------------- AKISSACK
			// ---------------------------------------------------------------------------------------

                        this.markerStaticIcon = null;
                        this.markerStaticStyle = new ol.style.Style({});
                }

                this.markerStyleKey = styleKey;
                this.markerSvgKey = svgKey;

                if (this.marker !== null) {
                        this.marker.setStyle(this.markerStyle);
                        this.markerStatic.setStyle(this.markerStaticStyle);
                }
        }

        if (this.markerStyleKey != styleKey) {
                //console.log(this.icao + " new rotation");
                this.markerIcon.setRotation(rotation * Math.PI / 180.0);
                this.markerIcon.setOpacity(opacity);
                if (this.staticIcon) {
                        this.staticIcon.setOpacity(opacity);
                }
                this.markerStyleKey = styleKey;
        }

        return true;
};

// Update our data
PlaneObject.prototype.updateData = function(receiver_timestamp, data) {
	// Update all of our data
	this.messages	= data.messages;
        this.rssi       = data.rssi;
	this.last_message_time = receiver_timestamp - data.seen;
        
        if (typeof data.type !== "undefined")
                this.addrtype	= data.type;
        else
                this.addrtype   = 'adsb_icao';

        if (typeof data.altitude !== "undefined")
		this.altitude	= data.altitude;
        if (typeof data.vert_rate !== "undefined")
		this.vert_rate	= data.vert_rate;
        if (typeof data.speed !== "undefined")
		this.speed	= data.speed;
        if (typeof data.track !== "undefined")
                this.track	= data.track;
        if (typeof data.lat !== "undefined") {
                this.position   = [data.lon, data.lat];
                this.last_position_time = receiver_timestamp - data.seen_pos;

                if (SitePosition !== null) {
                        var WGS84 = new ol.Sphere(6378137);
                        this.sitedist = WGS84.haversineDistance(SitePosition, this.position);
                }

                this.position_from_mlat = false;
                if (typeof data.mlat !== "undefined") {
                        for (var i = 0; i < data.mlat.length; ++i) {
                                if (data.mlat[i] === "lat" || data.mlat[i] == "lon") {
                                        this.position_from_mlat = true;
                                        break;
                                }
                        }
                }
        }
        if (typeof data.flight !== "undefined")
		this.flight	= data.flight;
        if (typeof data.squawk !== "undefined")
		this.squawk	= data.squawk;
        if (typeof data.category !== "undefined")
                this.category	= data.category;
};

PlaneObject.prototype.updateTick = function(receiver_timestamp, last_timestamp) {
        // recompute seen and seen_pos
        this.seen = receiver_timestamp - this.last_message_time;
        this.seen_pos = (this.last_position_time === null ? null : receiver_timestamp - this.last_position_time);
        
	// If no packet in over 58 seconds, clear the plane.
	if (this.seen > 58) {
                if (this.visible) {
                        //console.log("hiding " + this.icao);
                        this.clearMarker();
                        this.visible = false;
			if (SelectedPlane == this.icao)
                                selectPlaneByHex(null,false);
                }
	} else {
                if (this.position !== null && (this.selected || this.seen_pos < 60)) {
			this.visible = true;
			if (this.updateTrack(receiver_timestamp - last_timestamp + (this.position_from_mlat ? 30 : 5))) {
                                this.updateLines();
                                this.updateMarker(true);
                        } else { 
                                this.updateMarker(false); // didn't move
                        }
                } else {
			this.clearMarker();
			this.visible = false;
		}
	}
};

PlaneObject.prototype.clearMarker = function() {
	if (this.marker) {
                PlaneIconFeatures.remove(this.marker);
                PlaneIconFeatures.remove(this.markerStatic);
                /* FIXME google.maps.event.clearListeners(this.marker, 'click'); */
                this.marker = this.markerStatic = null;
	}
};

// Update our marker on the map
PlaneObject.prototype.updateMarker = function(moved) {
        if (!this.visible || this.position == null || this.isFiltered()) {
                this.clearMarker();
                return;
        }
        
        this.updateIcon();
        if (this.marker) {
                if (moved) {
                    this.marker.setGeometry(new ol.geom.Point(ol.proj.fromLonLat(this.position)));

		    // ---------------------------------------------------------------------
                    // AKISSACK - PERMANENT LABEL PART 2 - Update ---------------- ref: AK7A
		    // ---------------------------------------------------------------------
		    if (ShowPermanentLabels) {	
                        // Update label as as well as moving we may have gone up or down
                	var v = '-';  // An indication of level, climbing or decending
                	var labelText = '';
           		if (this.vert_rate >256) {
                  		v = UP_TRIANGLE;
                	} else {
                  		if (this.vert_rate < -256) {
                    			v = DOWN_TRIANGLE;
                  		}
	                };
			labelText = (this.flight ? this.flight : '-');
			labelText = labelText +' ['+(this.altitude ? parseInt(this.altitude/100) : '?')+v+']';
			labelText = labelText + '\n'+ (this.registration ? this.registration  : '');


                        if (this.selected && !SelectedAllPlanes ) {
                        	this.labelColour = '#ffff00' //this.labelColour = 'yellow' changed for semi transparency					
                        } else {
                        	this.labelColour = '#ffffff' //this.labelColour = 'white'			
                        }
  
			if (ShowAdditionalData) {
			    labelText = labelText +'\n'+this.ac_shortname;
			    if ((this.my_vet != 5 && this.my_vet != 6 && !this.selected)  || SelectedAllPlanes ){
                                
                            }
			}
			//var zmm = OLMap.getView().getZoom();
                        if (ZoomLvl <= 8) labelText = '';

			var hexColour      = this.labelColour;  // New section for semi transparency
			var myStrokeColour = ol.color.asArray(hexColour);
			myStrokeColour     = myStrokeColour .slice();
			myStrokeColour[3]  = (this.selected ? 0.5:0.25);  // change the alpha of the colour
			if (ShowAdditionalData) {
			    hexColour = (this.is_interesting ? '#ff0000' : '#0000ff');
			} else {hexColour = '#0000ff'}
			var myFillColour   = ol.color.asArray(hexColour);
			myFillColour       = myFillColour.slice();
			myFillColour[3]    = (this.selected ? 0.8:0.7);


                        var newS = new ol.style.Style({
         		       text: new ol.style.Text({
        		              text: labelText ,
        		              fill: new ol.style.Fill({
					color: myFillColour //(this.is_interesting ? 'rgb(255,0,0)' : 'rgb(0,0,255)')
				      }),
        		              stroke: new ol.style.Stroke({
					color: myStrokeColour, //this.labelColour, 
					width: 4
				      }),
                                      textAlign: 'left',
                                      textBaseline: "bottom",
                                      font: 'normal 9px tahoma',
        		              offsetX: +15,
        		              offsetY: +30
        		        }),
                                image: this.markerIcon
                        });
                        this.marker.setStyle(newS);
		    }
		    // ----------------------------------------------------------------------------------
                    // ------------------------------------------------------------------------- AKISSACK
		    // ----------------------------------------------------------------------------------

                    this.markerStatic.setGeometry(new ol.geom.Point(ol.proj.fromLonLat(this.position)));
                }
        } else {
		// ----------------------------------------------------------------------------------
                // AKISSACK - HOVER OVER LABELS ------------------------------------ ref: AK6A starts
		// ----------------------------------------------------------------------------------
		if (ShowHoverOverLabels)  {
                	var myPopUpName = '~';
   			this.marker = new ol.Feature({
                		geometry: new ol.geom.Point(ol.proj.fromLonLat(this.position)) ,
                		name : myPopUpName
                	});
		} else {
			this.marker = new ol.Feature(new ol.geom.Point(ol.proj.fromLonLat(this.position)));
		}
		// ----------------------------------------------------------------------------------
                // ------------------------------------------------------------------- ref: AK6A ends
		// ----------------------------------------------------------------------------------
                
                this.marker.hex = this.icao;
                this.marker.setStyle(this.markerStyle);
                PlaneIconFeatures.push(this.marker);

                this.markerStatic = new ol.Feature(new ol.geom.Point(ol.proj.fromLonLat(this.position)));
                this.markerStatic.hex = this.icao;
                this.markerStatic.setStyle(this.markerStaticStyle);
                PlaneIconFeatures.push(this.markerStatic);
	}
};

// Update our planes tail line,
PlaneObject.prototype.updateLines = function() {
        if (!this.selected)
                return;

        if (this.track_linesegs.length == 0)
                return;

        var estimateStyle = new ol.style.Style({
                stroke: new ol.style.Stroke({
                        color: '#a08080',
                        width: 0.75,		// Reduced width Ref: AK9A 
                        lineDash: [3, 3]     
                })
        });

	if (ShowMyPreferences) { // AKISSACK 
        	var airStyle = new ol.style.Style({
			stroke: new ol.style.Stroke({
				color: (this.is_interesting == 'Y' ? '#ff0000' : '#0000ff'),
        	                width: 0.75		// Reduced width Ref: AK9A 
        	        })
	        });
	} else {
        	var airStyle = new ol.style.Style({
                	stroke: new ol.style.Stroke({
	                       	color: '#000000',
                        	width: 0.75		// Reduced width Ref: AK9A 
                	})
       		});
	}

        var groundStyle = new ol.style.Style({
                stroke: new ol.style.Stroke({
                        color: '#408040',
                        width: 0.75		// Reduced width Ref: AK9A 
                })
        });

        // find the old elastic band so we can replace it in place
        // (which should be faster than remove-and-add when PlaneTrailFeatures is large)
        var oldElastic = -1;
        if (this.elastic_feature !== null) {
                oldElastic = PlaneTrailFeatures.getArray().indexOf(this.elastic_feature);
        }

        // create the new elastic band feature
        var lastseg = this.track_linesegs[this.track_linesegs.length - 1];
        var lastfixed = lastseg.fixed.getCoordinateAt(1.0);
        var geom = new ol.geom.LineString([lastfixed, ol.proj.fromLonLat(this.position)]);
        this.elastic_feature = new ol.Feature(geom);
        this.elastic_feature.setStyle(this.altitude === 'ground' ? groundStyle : airStyle);

        if (oldElastic < 0) {
                PlaneTrailFeatures.push(this.elastic_feature);
        } else {
                PlaneTrailFeatures.setAt(oldElastic, this.elastic_feature);
        }

        // create any missing fixed line features
        for (var i = 0; i < this.track_linesegs.length; ++i) {
                var seg = this.track_linesegs[i];
                if (seg.feature === null) {
                        seg.feature = new ol.Feature(seg.fixed);
                        if (seg.estimated) {
                                seg.feature.setStyle(estimateStyle);
                        } else if (seg.ground) {
                                seg.feature.setStyle(groundStyle);
                        } else {
                                seg.feature.setStyle(airStyle);
                        }

                        PlaneTrailFeatures.push(seg.feature);
                }
        }
};

PlaneObject.prototype.destroy = function() {
        this.clearLines();
        this.clearMarker();
};
