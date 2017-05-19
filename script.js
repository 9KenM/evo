//Main object container
var EVO = {};

EVO.params = {
	mass: 1,  // Solar masses
	age: 0, // in billions of years
	timescale: 0.01 // in billions of years
}
EVO.run = false;

EVO.age = EVO.params.age;
EVO.mass = EVO.params.mass;
EVO.star = STAR.generate(EVO.mass, EVO.age);

$(window).load(function(){
	REN.init();
	EVO.init();
});

EVO.init = function(){
	EVO.overview(EVO.star);
	$('#controls #timescale').val(EVO.params.timescale);
	$('#controls #age').val(EVO.age);
	$('#controls #mass').val(EVO.mass);
	$('#controls #play').click(function(){
		if(EVO.run) {
			EVO.run = false;
			$(this).html('>');
		} else {
			EVO.run = true;
			EVO.params.timescale = parseFloat( $('#controls #timescale').val() );
			EVO.age = parseFloat( $('#controls #age').val() );
			EVO.mass = parseFloat( $('#controls #mass').val() );
			$(this).html('||');
		}
	});
}


EVO.overview = function(data){

//	$('#info').append( 'Number of stars: '+data.starNum+'<br>' );
	$('#info').append( EVO.parseStarData(data) );

}

EVO.parseStarData = function(starData){
	EVO.writeStar(starData);
	REN.addElement('star', starData);
	REN.fgInvalid = true;
}

EVO.writeStar = function(star){
	$('#controls #age').val(EVO.age);
	$('#controls #mass').val(EVO.mass);

	var output = 'System<br><div class="star" style="color:rgb('+parseInt(star.color[0])+','+parseInt(star.color[1])+','+parseInt(star.color[2])+');">';
	$.each(star, function(i,v){
		output += i+': '+v+'<br>';
	});
	output += '</div>';

	$('#info').html(output);
}

