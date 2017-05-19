// Star Generator

STAR = {};

STAR.solTemp = 5778;

STAR.generate = function(massInitial, age){
	var star = {};

	//ZAMS properties
	this.massInitial = massInitial; // Solar mass
	this.lumInitial = STAR.lumInitial(this); // Solar lum
	this.radInitial = STAR.radInitial(this); // Solar radii
	this.tempInitial = STAR.tempInitial(this); // K

	//Lifetimes
	this.lifeMS = STAR.lifeMS(this); // Billions of years
	this.lifeSG = STAR.lifeSG(this); // Billions of years
	this.lifeRG = STAR.lifeRG(this); // Billions of years

	//Current properties
	this.age = age; // Billions of years
	this.stage = STAR.stage(this);
	this.lum = STAR.lum(star);
	this.temp = STAR.temp(star);
	this.rad = STAR.rad(star);
	this.mass = STAR.mass(star);
	this.color = STAR.color(star);
	this.type = STAR.type(star);

	return star;
}

STAR.lumInitial = function(star){
	var mass = star.massInitial;
	var lum;

	if(mass <= 0.43) { lum = 0.23 * Math.pow(mass, 2.3) }
	else if(mass <= 2) { lum = Math.pow(mass, 4) }
	else if(mass <= 20) { lum = 1.5 * Math.pow(mass, 3.5)}
	else { lum = Math.pow(mass, 4) }

	return lum;
}

STAR.radInitial = function(star){
	var mass = star.massInitial;
	var rad;

	if(mass < 1) { rad = Math.pow(mass, 0.57) }
	else { rad = Math.pow(mass, 0.8) }

	return rad;
}

STAR.lifeMS = function(star){
	var mass = star.massInitial;
	var lum = star.lumInitial;
	var life;
	var f = 1; //hydrogen fraction

	life = 10 * f * mass / lum;

	return life;
}

STAR.lifeSG = function(star){
	var lifeMS = star.lifeMS;
	var lifeSG;

	lifeSG = lifeMS / 10; // 10% of MS lifetime

	return lifeSG;
}

STAR.lifeRG = function(star){
	var lifeMS = star.lifeMS;
	var lifeRG;

	lifeRG = lifeMS / 10; // 10% of MS lifetime

	return lifeRG;
}

STAR.tempInitial = function(star){
	var lum = star.lumInitial;
	var rad = star.radInitial;
	var temp;

	temp = Math.pow( lum / Math.pow(rad,2), 1/4 ) * STAR.solTemp;

	return temp;
}

STAR.stage = function(star){
	var lifeMS = star.lifeMS;
	var lifeSG = star.lifeSG;
	var lifeRG = star.lifeRG;
	var massInitial = star.massInitial;
	var age = star.age;
	var stage;

	if(age <= lifeMS) { stage = 'main sequence' } // V
	else if(age <= lifeMS + lifeSG) { stage = 'subgiant' } // IV
	else if(age <= lifeMS + lifeSG + lifeRG) { stage = 'giant' } // III
	else {
		if(massInitial <= 8) { stage = 'white dwarf' }
		else if(massInitial <= 25) { stage = 'neutron star' }
		else { stage = 'black hole' }
	}

	return stage;
}

STAR.mass = function(star){
	var stage = star.stage;
	var initial = star.massInitial;
	var lum = star.lum;
	var rad = star.rad;
	var age = star.age;
	var ageSG = age - star.lifeMS
	var ageRG = age - (star.lifeMS + star.lifeSG);
	var mass;

	reimersLaw = function(massCurrent){ var rate = 0.4 * 4 * Math.pow(10, -13) * ((lum * rad) / massCurrent); return rate; }

	if(stage == 'main sequence') { mass = initial }
	else if(stage == 'subgiant') { mass = initial - reimersLaw(initial) * ageSG }
	else if(stage == 'giant') { mass = initial - reimersLaw(initial) * (ageSG + ageRG) }
	else if(stage == 'white dwarf') { mass = (initial - 0.1) / (8 - 0.1) * (1.4 - 0.9) }
	else if(stage == 'neutron star') { mass = (initial - 8) / (25 - 8) * (3.2 - 1.4) }
	else if(stage == 'black hole') { mass = initial / 8 }

	return mass;
}

STAR.lum = function(star){
	var stage = star.stage;
	var massInitial = star.massInitial;
	var initial = star.lumInitial;
	var max = initial + initial / (18*massInitial);
	var age = star.age;
	var lifeMS = star.lifeMS;
	var lum;

	var eddingtonLimit = 32000 * massInitial; // Estimated

	if(stage == 'main sequence') { lum = initial + ( (age / lifeMS) * (max - initial) ) }
	else if(stage == 'subgiant') { lum = max * 5 >= eddingtonLimit ? eddingtonLimit : max * 5 }
	else if(stage == 'giant') { lum = max * 25 >= eddingtonLimit ? eddingtonLimit : max * 25 }
	else if(stage == 'white dwarf') { lum = Math.pow(STAR.rad(star), 2) * Math.pow(STAR.temp(star) / STAR.solTemp, 4) }
	else if(stage == 'neutron star') { lum = Math.pow(STAR.rad(star), 2) * Math.pow(STAR.temp(star) / STAR.solTemp, 4) }
	else if(stage == 'black hole') { lum = Math.pow(STAR.rad(star), 2) * Math.pow(STAR.temp(star) / STAR.solTemp, 4) }

	return lum;
}

STAR.temp = function(star){
	var stage = star.stage;
	var initial = star.tempInitial;
	var ageSG = star.age - star.lifeMS;
	var lifeSG = star.lifeSG;
	var ageRG = star.age - (star.lifeMS + star.lifeSG);
	var lifeRG = star.lifeRG;
	var ageREM = star.age - (star.lifeMS + star.lifeSG + star.lifeRG);
	var temp;

	if(stage == 'main sequence') { temp = initial }
	else if(stage == 'subgiant') { temp = (initial < 7000 ? initial : 7000) - ((ageSG / lifeSG) * ((initial < 7000 ? initial : 7000) - (initial < 4800 ? initial : 4800))) }
	else if(stage == 'giant') { temp = 4800 - (ageRG / lifeRG) * (4800 - 3000) }
	else if(stage == 'white dwarf') {
		if(ageREM <= 0.1) { temp = 100000 - (ageREM / 0.1) * (100000 - 20000) }
		else { temp = 20000 - (ageREM / 99999999) * (20000 - 5) }
	}
	else if(stage == 'neutron star') {
		if(ageREM <= 0.000001) { temp = 1000000000000 - ageREM / 0.000001 * (1000000000000 - 1000000) }
		else { temp = 1000000 - (ageREM / 99999999) * (1000000 - 5) }
	}
	else if(stage == 'black hole') { temp = (1.228 * Math.pow(10,23)) / (STAR.mass(star) * (1.9891 * Math.pow(10,30))) } // Hawking Radiation temperature derived from http://library.thinkquest.org/C007571/english/advance/

	return temp;
}

STAR.rad = function(star){
	var stage = star.stage;
	var initial = star.radInitial;
	var lum = star.lum;
	var temp = star.temp;
	var rad;

	if(stage == 'main sequence') { rad = Math.pow(STAR.solTemp / temp, 2) * Math.sqrt(lum) }
	else if(stage == 'white dwarf') { rad = 0.01 * Math.pow( 1 / STAR.mass(star), 1/3 ) }
	else if(stage == 'neutron star') { rad = Math.pow(STAR.mass(star) / (9.97676865 * Math.pow(10,17)), 1/3) } // Tolman solution VII
	else if(stage == 'black hole') { rad = (2.95 * STAR.mass(star)) / 696000 } // Schwarzschild Radius converted to solar radii
	else { rad = Math.pow(STAR.solTemp / temp, 2) * Math.sqrt(lum) }

	return rad;
}

STAR.type = function(star){
	var mass = star.mass;
	var temp = star.temp;
	var lum = star.lum;
	var stage = star.stage;
	var specType, specSubType, lumType, type;

	if(temp <= 600) { specType = 'Y' }
	else if(temp <= 1300) { specType = 'T'}
	else if(temp <= 2000) { specType = 'L'}
	else if(temp <= 3900) { specType = 'M'}
	else if(temp <= 5200) { specType = 'K'}
	else if(temp <= 6000) { specType = 'G'}
	else if(temp <= 7600) { specType = 'F'}
	else if(temp <= 10000) { specType = 'A'}
	else if(temp <= 30000) { specType = 'B'}
	else { specType = 'O'}

	if(specType == 'Y') { specSubType = Math.floor(temp / 600 * 9.9) }
	else if(specType == 'T') { specSubType = Math.floor((temp - 600) / (1300 - 600) * 9.9)}
	else if(specType == 'L') { specSubType = Math.floor((temp - 1300) / (2000 - 1300) * 9.9)}
	else if(specType == 'M') { specSubType = Math.floor((temp - 2000) / (3900 - 2000) * 9.9)}
	else if(specType == 'K') { specSubType = Math.floor((temp - 3900) / (5200 - 3900) * 9.9)}
	else if(specType == 'G') { specSubType = Math.floor((temp - 5200) / (6000 - 5200) * 9.9)}
	else if(specType == 'F') { specSubType = Math.floor((temp - 6000) / (7600 - 6000) * 9.9)}
	else if(specType == 'A') { specSubType = Math.floor((temp - 7600) / (10000 - 7600) * 9.9)}
	else if(specType == 'B') { specSubType = Math.floor((temp - 10000) / (30000 - 10000) * 9.9)}
	else if(specType == 'O') { specSubType = Math.floor((temp - 30000) / (1000000 - 30000) * 9.9)}

	specType = specType+specSubType;

	if(stage == 'subgiant') { lumType = 'IV' }
	else if(stage == 'giant') {
		if(lum >= 1000000) { lumType = 'Ia0'}
		else if(lum >= 10000) { lumType = 'I' }
		else if(lum >= 5000) { lumType = 'II' }
		else { lumType = 'III' }
	}
	else { lumType = 'V'}

	if(stage == 'black hole') { type = 'X' }
	else if(stage == 'neutron star') { type = 'Q' }
	else if(stage == 'white dwarf') { type = 'D' }
	else { type = specType+lumType }

	return type;
}

STAR.color = function(star){
	var temp = star.temp;
	// Color algorithm from http://www.tannerhelland.com/4435/convert-temperature-rgb-algorithm-code/

	result = [];

	if(temp < 1000) temp = 1000;
	if(temp > 40000) temp = 40000;

	temp = temp / 100;

	// Red
	if(temp <= 66){
		red = 255;
	} else {
		red = temp - 60;
		red = 329.698727446 * Math.pow(red, -0.1332047592);
		if(red < 0) red = 0;
		if(red > 255) red = 255;
	}

	// Green
	if(temp <= 66) {
		green = temp;
		green = 99.4708025861 * Math.log(green) - 161.1195681661;
		if(green < 0) green = 0;
		if(green > 255) green = 255;
	} else {
		green = temp - 60;
		green = 288.1221695283 * Math.pow(green, -0.0755148492);
		if(green < 0) green = 0;
		if(green > 255) green = 255;
	}

	// Blue
	if(temp >= 66) {
		blue = 255;
	} else if (temp <= 19) {
		blue = 0;
	} else {
		blue = temp - 10;
		blue = 138.5177312231 * Math.log(blue) - 305.0447927307;
		if(blue < 0) blue = 0;
		if(blue > 255) blue = 255;
	}

	result = [parseInt(red), parseInt(green), parseInt(blue)];

	return result;
}
