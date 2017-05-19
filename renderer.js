// Set renderer namespace
var REN = {};

/*
The draw canvas (dCanvas) is the width and height of the window. Everything gets drawn to the draw canvas.

The buffer is broken up into layers which are then composited onto the draw canvas. The buffer layers consist of
a foreground layer, where all the action happens, and then an arbitrary number of background layers dependent upon
the number of background tile URLs specified in the bgURLs array.

When the main draw function is executed, the game will grab pixel data from the buffer canvases and composite them
onto the draw canvas. The frame size and x/y locations determine what pixel data will be read from each buffer canvas.

*/

REN.init = function(){

	REN.stats = true;
	if(REN.stats) {
		REN.renderStats = new Stats();
		document.body.appendChild(REN.renderStats.domElement);
		REN.renderStats.domElement.style.position = 'absolute';
		REN.renderStats.domElement.style.right = '0px';
		REN.renderStats.domElement.style.top = '0px';
	}

	// Dragging and scrolling
	REN.mouseX;
	REN.mouseY;
	REN.dragOn = false;
	REN.dragStartX;
	REN.dragStartY;
	REN.dragFrameStartX;
	REN.dragFrameStartY;

	// Item hovering
	REN.hovered = {};
	REN.selected = {};
	REN.hoverIcon = new Image();
	REN.hoverIcon.src = 'img/hover.png';
	REN.hovering = false;

	// Item selection
	REN.selectIcon = new Image();
	REN.selectIcon.src = 'img/selector.png';
	REN.selectArrow = document.createElement('canvas');
	REN.selectArrow.width = 32;
	REN.selectArrow.height = 32;
	REN.selectArrowCTX = REN.selectArrow.getContext('2d');
	REN.selectArrowIcon = new Image();
	REN.selectArrowIcon.onload = function(){REN.selectArrowCTX.drawImage(REN.selectArrowIcon,0,0)}
	REN.selectArrowIcon.src = 'img/arrowU.png';
	REN.selectArrowX;
	REN.selectArrowY;

	// Drawing
	REN.mapWidth = 3000;
	REN.mapHeight = 3000;
	REN.frameWidth = $('#viewport').innerWidth();
	REN.frameHeight = $('#viewport').innerHeight();
	REN.frameHalfWidth = function(){ return REN.frameWidth/2 };
	REN.frameHalfHeight = function(){ return REN.frameHeight/2 };
	REN.frameX = REN.mapWidth / 2 - REN.frameHalfWidth();
	REN.frameY = REN.mapHeight / 2 - REN.frameHalfHeight();
	REN.scale = 1;
	REN.zoom = 1;
	REN.elements = [];

	// Draw canvas	
	REN.dCanvas = document.getElementById('canvas');
	REN.dCanvas.width = REN.frameWidth;
	REN.dCanvas.height = REN.frameHeight;
	REN.dCTX = REN.dCanvas.getContext('2d');
	REN.dInvalid = true;
	REN.dCanvas.onselectstart = function () {return false;}
	REN.dCanvas.onmousedown = function () {return false;}


	// Foreground Canvas
	REN.fgCanvas = document.createElement('canvas');
	REN.fgCanvas = document.createElement('canvas');
	REN.fgCanvas.width = REN.mapWidth;
	REN.fgCanvas.height = REN.mapHeight;
	REN.fgCTX = REN.fgCanvas.getContext('2d');
	REN.fgInvalid = true;

	// Background canvases
	REN.bgImages = ['img/cloudsR2.jpg', 'img/cloudsB2.jpg', 'img/starfield.png'];
	REN.bg = [];
	REN.bgInit();

	$('#viewport').mousemove(function(e){               //Get mouse coordinates on mouse move
		REN.mouseX = Math.floor(e.pageX - $('#viewport').offset().left);				 //Math.floor, because the canvas can sometimes be offset by an extra 0.5 pixels.
		REN.mouseY = Math.floor(e.pageY - $('#viewport').offset().top);
		if (REN.mouseX<0) {REN.mouseX = 0};
		if (REN.mouseX>REN.mapWidth) {REN.mouseX = REN.mapWidth};
		if (REN.mouseY<0) {REN.mouseY = 0};
		if (REN.mouseY>REN.mapHeight) {REN.mouseY = REN.mapHeight};
//		$('#xcoord').text(REN.frameX + REN.mouseX);                   //Display coordinates
//		$('#ycoord').text(REN.frameY + REN.mouseY);
		if (REN.dragOn) {REN.frameDrag()}
		// Draw invalid if moving off of hover object
		if (REN.frameX + REN.mouseX < REN.hovered.x ||
			REN.frameX + REN.mouseX > REN.hovered.x + 16 ||
			REN.frameY + REN.mouseY < REN.hovered.y ||
			REN.frameY + REN.mouseY > REN.hovered.y + 16
		){REN.dInvalid = true}
	});

	$('#viewport').mousedown(function(e){
		var x = REN.frameX + REN.mouseX;
		var y = REN.frameY + REN.mouseY;
		for (var i=0; i < REN.elements.length; i++) {
			var ey = REN.elements[i].y;
			var ex = REN.elements[i].x;
			var es = 16;
			if(y > ey-es/2 && y < ey+es/2 && x > ex-es/2 && x < ex+es/2){
				REN.selected = REN.elements[i];
				//$('#selIcon').html(selected.icon);
				$('#selName').html(selected.name);
				$('#selInfo').html('<ul></ul>');
				for(ci = 0; ci < selected.starNum; ci++) {
					$('#selInfo ul').append('<li></li>');
					$('#selInfo ul li').eq(ci).append(selected.stars[ci].icon);
					$('#selInfo ul li').eq(ci).append(selected.stars[ci].name);
				}
				if($('#selected').css('display') == 'none'){
					$('#selected').fadeIn();
				}		
			}
	  	}

		if (!REN.dragOn) {
			REN.dragFrameStartX = REN.frameX;
			REN.dragFrameStartY = REN.frameY;
	 		REN.dragStartX = REN.mouseX;
			REN.dragStartY = REN.mouseY;
			REN.dragOn=true;
			$('#viewport>canvas').addClass('drag');
		}
	
		REN.dInvalid = true;
	});
	$(document).mouseup(function(){
		if (REN.dragOn){
			REN.dragOn=false;
			$('#viewport>canvas').removeClass('drag');
		}
	});

	$(window).resize(function(){
		REN.frameWidth = $('#viewport').innerWidth();
		REN.frameHeight = $('#viewport').innerHeight();
		REN.dCTX.canvas.width  = REN.frameWidth;
		REN.dCTX.canvas.height = REN.frameHeight;
		REN.dInvalid = true;
	});
	$('#viewport').mousewheel(function(e, d, dX, dY){
		var scaleAmt = dY / 1000;
		REN.scale = REN.scale + scaleAmt;
		REN.zoom = REN.zoom + scaleAmt;
		var newFrameWidth = REN.frameWidth - (REN.dCanvas.width * scaleAmt * 2);
		var newFrameHeight = REN.frameHeight - (REN.dCanvas.height * scaleAmt * 2);
		REN.frameWidth = newFrameWidth > REN.dCanvas.width ? newFrameWidth : REN.frameWidth;
		REN.frameHeight = newFrameHeight > REN.dCanvas.height ? newFrameHeight : REN.frameHeight;
		REN.dInvalid = true;
		return false;
	});

/*
	REN.bg0Canvas = document.createElement('canvas');
	REN.bg0Canvas.width = REN.mapWidth;
	REN.bg0Canvas.height = REN.mapHeight;
	REN.bg0CTX = REN.bg0Canvas.getContext('2d');
	REN.bg0Image = new Image();
	REN.bg0Image.onload = function(){
		REN.bg0CTX.fillStyle = REN.bg0CTX.createPattern(REN.bg0Image, 'repeat');
		REN.bg0CTX.fillRect(0, 0, REN.mapWidth, REN.mapHeight);
	}
	REN.bg0Image.src = 'img/cloudsR2.jpg';

	REN.bg1Canvas = document.createElement('canvas');
	REN.bg1Canvas.width = REN.mapWidth;
	REN.bg1Canvas.height = REN.mapHeight;
	REN.bg1CTX = REN.bg1Canvas.getContext('2d');
	REN.bg1Image = new Image();
	REN.bg1Image.onload = function(){
		REN.bg1CTX.fillStyle = REN.bg1CTX.createPattern(REN.bg1Image, 'repeat');
		REN.bg1CTX.fillRect(0, 0, REN.mapWidth, REN.mapHeight);
	}
	REN.bg1Image.src = 'img/cloudsB2.jpg';

	REN.bg2Canvas = document.createElement('canvas');
	REN.bg2Canvas.width = REN.mapWidth;
	REN.bg2Canvas.height = REN.mapHeight;
	REN.bg2CTX = REN.bg2Canvas.getContext('2d');
	REN.bg2Image = new Image();
	REN.bg2Image.onload = function(){
		REN.bg2CTX.fillStyle = REN.bg2CTX.createPattern(REN.bg2Image, 'repeat');
		REN.bg2CTX.fillRect(0, 0, REN.mapWidth, REN.mapHeight);
	}
	REN.bg2Image.src = 'img/starfield.png';
*/

	(function animloop(){
		requestAnimFrame(animloop);
		REN.run();
	})();
}

REN.bgInit = function(){
	$.each(REN.bgImages, function(i,imageURL){
		REN.bg[i] = {};
		REN.bg[i].canvas = document.createElement('canvas');
		REN.bg[i].canvas.width = REN.mapWidth;
		REN.bg[i].canvas.height = REN.mapHeight;
		REN.bg[i].context = REN.bg[i].canvas.getContext('2d');
		REN.bg[i].image = new Image();
		REN.bg[i].image.onload = function(){
			REN.bg[i].context.fillStyle = REN.bg[i].context.createPattern(REN.bg[i].image, 'repeat');
			REN.bg[i].context.fillRect(0, 0, REN.mapWidth, REN.mapHeight);
			REN.dInvalid = true;
		}
		REN.bg[i].image.src = imageURL;
	});
}

REN.fgDraw = function(){
	REN.fgCTX.clearRect(0, 0, REN.mapWidth, REN.mapHeight);
	for (var i=0; i < REN.elements.length; i++) {
		REN.elements[i].draw(REN.fgCTX);
	}
	REN.fgInvalid = false;
	REN.dInvalid = true;
}

REN.draw = function() {
	REN.dCTX.clearRect(0, 0, REN.frameWidth, REN.frameHeight);
	REN.dCTX.globalCompositeOperation = 'lighter';

	REN.dCTX.scale(REN.scale, REN.scale);

	REN.frameComposite(REN.bg[2].context, 3);
	REN.frameComposite(REN.bg[0].context, 2);
	REN.frameComposite(REN.bg[1].context, 1.5);
	REN.frameComposite(REN.fgCTX);

	//Draw hovered indicator
	var x = REN.frameX + REN.mouseX;
	var y = REN.frameY + REN.mouseY;
	var ey = REN.hovered.y;
	var ex = REN.hovered.x;
	var es = 16;
	if(y > ey-es/2 && y < ey+es/2 && x > ex-es/2 && x < ex+es/2){
		REN.dCTX.drawImage(REN.hoverIcon,REN.hovered.x-es/2-REN.frameX,REN.hovered.y-es/2-REN.frameY, es, es);
		REN.dCTX.fillStyle = '#00ff00';
		REN.dCTX.textAlign = 'center';
		REN.dCTX.font = "8px Arial";
		REN.dCTX.fillText(REN.hovered.id, REN.hovered.x-REN.frameX, REN.hovered.y-REN.frameY-es);
	}

	//Draw selected indicator
	REN.drawSelectArrow(REN.dCTX);
	REN.dCTX.drawImage(REN.selectIcon,REN.selected.x-es/2-REN.frameX,REN.selected.y-es/2-REN.frameY, es, es);


/*
	for (var i = 0; i <= REN.elements.length - 1; i++) {
		REN.elements[i].draw(REN.dCTX);
	}	
*/
	REN.scale = 1;
	REN.dInvalid = false;
};

REN.update = function() {
  for (var i=0; i < REN.elements.length; i++) {
    REN.elements[i].update();
  }
  REN.selectArrowUpdate();
};

REN.frameComposite = function(context, offset){
	if(!offset){offset = 1}
	REN.dCTX.drawImage(context.canvas, Math.floor(REN.frameX/offset),  Math.floor(REN.frameY/offset), REN.frameWidth, REN.frameHeight, 0, 0, REN.frameWidth, REN.frameHeight);
}

REN.drawSelectArrow = function(context){
	if(REN.selectArrowX == 0 || REN.selectArrowX == REN.frameWidth-16 || REN.selectArrowY == 0 || REN.selectArrowY == REN.frameHeight-16){
		context.drawImage(REN.selectArrow, REN.selectArrowX, REN.selectArrowY, 16, 16);
	}
}

REN.selectArrowUpdate = function(){
	var es = 16;
	var a = -(REN.selected.x-es/2-REN.frameX-REN.frameHalfWidth());
	var b = -(REN.selected.y-es/2-REN.frameY-REN.frameHalfHeight());
	var angle = -Math.atan2(a,b);
	REN.selectArrowX = REN.selected.x-REN.frameX <= 0 ? 0 : REN.selected.x-REN.frameX >= REN.frameWidth ? REN.frameWidth-es : REN.selected.x-es/2-REN.frameX;
	REN.selectArrowY = REN.selected.y-REN.frameY <= 0 ? 0 : REN.selected.y-REN.frameY >= REN.frameHeight ? REN.frameHeight-es : REN.selected.y-es/2-REN.frameY;
	REN.selectArrowCTX.clearRect(0, 0, REN.selectArrow.width, REN.selectArrow.height);
	REN.selectArrowCTX.save();
	REN.selectArrowCTX.translate(REN.selectArrow.width/2,REN.selectArrow.height/2);
	REN.selectArrowCTX.rotate(angle);
	REN.selectArrowCTX.drawImage(REN.selectArrowIcon,-REN.selectArrow.width/2,-REN.selectArrow.height/2);
	REN.selectArrowCTX.restore();
}

REN.frameDrag = function(){
	REN.frameX = REN.dragStartX-REN.mouseX+REN.dragFrameStartX;
	if(REN.frameX < 0){
		REN.frameX = 0;
	} else if(REN.frameX + REN.frameWidth > REN.mapWidth) {
		REN.frameX = REN.mapWidth - REN.frameWidth;
	}
	
	REN.frameY = REN.dragStartY-REN.mouseY+REN.dragFrameStartY;
	if(REN.frameY < 0){
		REN.frameY = 0;
	} else if(REN.frameY + REN.frameHeight > REN.mapHeight) {
		REN.frameY = REN.mapHeight - REN.frameHeight;
	}

	REN.dInvalid = true;
}

REN.addElement = function(type, id, elem) {
  REN.elements.push(new REN.element(type, id, elem));
};

REN.run = (function() {
var loops = 0, skipTicks = 1000 / 60,
	maxFrameSkip = 10,
	nextGameTick = (new Date).getTime();

	return function() {
	  loops = 0;

	  while ((new Date).getTime() > nextGameTick) {
		REN.update();
		nextGameTick += skipTicks;
		loops++;
	  }

	  if(REN.stats) REN.renderStats.update();
	  if(REN.fgInvalid){REN.fgDraw()}
	  if(REN.dInvalid){REN.draw()}
	};
})();


REN.element = function(type, elem) {
	this.type = type;
	this.id = 'star-'+REN.elements.length;
	this.luminosity = elem.lum;
	if (type == 'star') {
		this.radius = elem.rad;
		this.drawRadius = this.radius * 5;
		if(this.drawRadius < 1) this.drawRadius = 1;
		this.xOffset = REN.mapWidth / 2; //REN.elements[this.id.slice(5)-1] ?
//				REN.elements[this.id.slice(5)-1].xOffset + 2*REN.elements[this.id.slice(5)-1].drawRadius + 10 :
//				REN.mapWidth / 2; //this.drawRadius;
	//	console.log(REN.elements[this.id.slice(5)-1])
		this.x = 260;
		this.y = 0;
		this.color = elem.color;
		this.draw = function(context){
			REN.drawStar(this, context);
		}
		
		this.update = function() {
			if(EVO.run) {
				EVO.age = EVO.age + EVO.params.timescale;
				var star = STAR.generate(EVO.mass, EVO.age);
				var element = new REN.element( 'star', star );
				REN.elements[0] = element;
				EVO.writeStar(star);
				REN.fgInvalid = true;
			}
		}
		
	}
}

REN.drawStar = function(star, context){
	var offset = star.xOffset;
	var radius = star.drawRadius;
	var left = 10 + offset;
	var right = 10 + offset + radius;
	var top = 10;
	var bottom = 10 + 2*radius;

	context.beginPath();
	context.arc(10 + offset, REN.mapHeight / 2, radius, 0, Math.PI*2, false); 
	var gradient = context.createRadialGradient(10 + offset, REN.mapHeight / 2, radius / 4, 10 + offset, REN.mapHeight / 2, radius);
	gradient.addColorStop(0, 'white');
	gradient.addColorStop(0.5, 'rgb('+parseInt(star.color[0])+', '+parseInt(star.color[1])+', '+parseInt(star.color[2])+')');
	gradient.addColorStop(1, 'rgba(0,0,0,0)');
	context.fillStyle = gradient; //'rgb('+parseInt(star.color[0])+', '+parseInt(star.color[1])+', '+parseInt(star.color[2])+')';
	context.fill();
	context.closePath();
/*
	context.beginPath();
	context.moveTo(left, top);
	context.lineTo(left, bottom);
	context.moveTo(left - radius, top + radius);
	context.lineTo(right, top + radius);

	var gradient2 = context.createRadialGradient(10 + offset, 10 + radius, 1, 10 + offset, 10 + radius, radius);
	gradient2.addColorStop(0, 'white');
	gradient2.addColorStop(0.5, 'rgba('+parseInt(star.color[0])+', '+parseInt(star.color[1])+', '+parseInt(star.color[2])+', 0.1)');
	gradient2.addColorStop(1, 'rgba(0,0,0,0)');

	context.strokeStyle = gradient2; //'rgba(255,255,255,0.5)';
	context.stroke();
	context.closePath();
*/
}

function circleIntersect(r0,x0,y0,r1,x1,y1) {
	var distance = Math.sqrt(Math.pow((x1-x0),2) + Math.pow((y1-y0),2));
	if (distance > (r0+r1)) {return false}
	else {return true}
//	else if (distance < Math.abs(r0-r1)) {return true}
//	else if (distance == 0) {return true}
}

function drawLine(context,x0,y0,x1,y1,color,width) {
	context.beginPath();
	context.moveTo(x0,y0);
	context.lineTo(x1,y1);
	context.closePath();
	context.lineWidth = width;
	context.strokeStyle = color;
	context.stroke();
}

// shim layer with setTimeout fallback
window.requestAnimFrame = (function(){
return  window.requestAnimationFrame       || 
        window.webkitRequestAnimationFrame || 
        window.mozRequestAnimationFrame    || 
        window.oRequestAnimationFrame      || 
        window.msRequestAnimationFrame     || 
        function( callback ){
          window.setTimeout(callback, 1000 / 60);
        };
})();
