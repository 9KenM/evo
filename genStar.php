<?php
	require('genTables.php');

	// Generate star system
	class SYS {
		var $starNum = 1;
	}

	class STAR {
		function __construct(){
			global $preceder;
			$this->spectralType = genSpecType();

			if($this->spectralType == 'PSR' || $this->spectralType == 'AXP' || $this->spectralType == 'SGR') {
				$this->spectralSubtype = '';
				$this->luminosityType = '';
				$this->temperature = mt_rand(10000000, 10000000000000);
				$this->mass = mt_rand(14,32) / 10;
				$this->radius = 14 * pow($this->mass / 1.4, -1/3) / 695500;
				$this->luminosity = genLum($this);
			} else if ($this->spectralType == 'X') {
				$this->spectralSubtype = '';
				$this->luminosityType = '';
				$this->mass = mt_rand(32,200) / 10;
				$this->temperature = pow(1.227 * 10, 23) / $this->mass / pow(1.9891 * 10, 30);
				$this->radius = 2.95 * $this->mass / 695500; // Schwarzschild radius
				$this->luminosity = genLum($this);
			} else {
				$this->luminosityType = genLumType($this);
				$this->spectralSubtype = genSpecSubtype($this);
				$this->radius = genRad($this);
				$this->temperature = genTemp($this);
				$this->mass = genMass($this);
				$this->luminosity = genLum($this);
			}
			$this->HZ = genHZ($this->luminosity);
			$this->color = genColor($this->temperature);
			$preceder = $this;
		}
	}

	class PLANET {}

	class BARYCENTER {
		function __construct($primary){
//			global $preceder;
//			$primary = $preceder;
			$companion = genStars(new STAR());

			$maxSep =
				$companion->orbit["maxSeparation"] || $primary->orbit["maxSeparation"] ?
				$companion->orbit["maxSeparation"] > $primary->orbit["maxSeparation"] ?
				$companion->orbit["maxSeparation"] : $primary->orbit["maxSeparation"] :
				0;

			$avgSep = genStarSep($maxSep);
			$eccen = genEccentricity($avgDist);
			$this->orbit = array(
				"avgSeparation" => $avgSep,
				"eccentricity" => $eccen,
				"minSeparation" => (1 - $eccen) * $avgSep,
				"maxSeparation" => (1 + $eccen) * $avgSep
			);

			$this->stars = array(genStars($primary), $companion);
			$this->mass = $primary->mass + $companion->mass;
			$this->luminosity = $primary->luminosity + $companion->luminosity;
			$this->HZ = genHZ($this->luminosity);
			$this->type = 'barycenter';
		}
//		var $planets = array();
//		var $starNum = 1;
//		var $HZ = array();
	}


	// New system
	$system = new SYS();
	$system->barycenters = genStars(new STAR());

	$data = $system;

	function genStars($star){
		global $system;
//		$star = new STAR();

		if(genHasCompanion($star)) {
			$system->starNum ++;
			return new BARYCENTER($star);
		} else {
			return $star;
		}
	}

	function genHasCompanion($star){
		global $system;
		$roll = mt_rand(1,100);
		if(
			$star->spectralType == 'O' ||
			$star->spectralType == 'B' ||
			$star->luminosityType == '0' ||
			$star->luminosityType == 'Ia' ||
			$star->luminosityType == 'Ib' ||
			$star->luminosityType == 'II' ||
			$star->luminosityType == 'III'
			) {
			$chance = 80 / $system->starNum;
		} else if (
			$star->spectralType == 'A' ||
			$star->spectralType == 'F' ||
			$star->spectralType == 'G' ||
			$star->spectralType == 'K' ||
			$star->luminosityType == 'IV' ||
			$star->luminosityType == 'V'
			) {
			$chance = 50 / $system->starNum;
		} else {
			$chance = 25 / $system->starNum;
		}

		if($roll <= $chance) {
			return true;
		} else {
			return false;
		}
	}

	function genStarSep($innerDist){
		global $system;
		$roll = mt_rand(1,100);
		if($innerDist == 0 && $system->starNum == 2) {
			switch($roll){
				case($roll <= 9):
					$dist = mt_rand(1,100) < 96 ? (mt_rand(1,8) + mt_rand(1,8)) * 0.0067 : 0;
					break;
				case($roll <= 18):
					$dist = mt_rand(1,12) / 10;
					break;
				case($roll <= 36):
					$dist = mt_rand(1,20);
					break;
				case($roll <= 64):
					$dist = (mt_rand(1,6) + mt_rand(1,6)) * 10;
					break;
				case($roll <= 82):
					$dist = mt_rand(1,12) * 100;
					break;
				case($roll <= 91):
					$dist = mt_rand(1,12) * 1000;
					break;
				default:
					$dist = mt_rand(1,6) * 10000;
			}
		} else if($innerDist == 0) {
			switch($roll){
				case ($roll <= 14):
					$dist = mt_rand(1,100) < 96 ? (mt_rand(1,8) + mt_rand(1,8)) * 0.0067 : 0;
					break;
				case ($roll <= 29):
					$dist = mt_rand(1,12) / 10;
					break;
				case ($roll <= 58):
					$dist = mt_rand(1,20);
					break;
				default:
					$dist = (mt_rand(1,6) + mt_rand(1,6)) * 10;
			}
		} else {
			switch($roll){
				case($roll <= 50):
					$dist = mt_rand(1,12) * 100;
					break;
				case($roll <= 83):
					$dist = mt_rand(1,12) * 1000;
					break;
				default:
					$dist = mt_rand(1,6) * 10000;
			}
		}
		if($dist < $innerDist * 3) $dist = $innerDist * 3;
		return $dist;
	}

	function genEccentricity($dist){
		$modifier =
			$dist <= 0.6 ? -6 :
			$dist <= 6 ? -4 :
			$dist <= 24 ? -2 :
			0;

		$roll = mt_rand(1,6) + mt_rand(1,6) + mt_rand(1,6) + $modifier;
		switch($roll){
			case($roll <= 3): $result = 0; break;
			case($roll <= 4): $result = 0.1; break;
			case($roll <= 5): $result = 0.2; break;
			case($roll <= 6): $result = 0.3; break;
			case($roll <= 8): $result = 0.4; break;
			case($roll <= 11): $result = 0.5; break;
			case($roll <= 13): $result = 0.6; break;
			case($roll <= 15): $result = 0.7; break;
			case($roll <= 16): $result = 0.8; break;
			case($roll <= 17): $result = 0.9; break;
			default: $result = 0.95; break;
		}
		return $result;
	}

	function genSpecType(){
		global $system;
		global $preceder;
		$result;
		$modifier;

		if($preceder) {
			switch ($preceder->spectralType) {
				case 'A': $modifier = 6; break;
				case 'F': $modifier = 10; break;
				case 'G': $modifier = 18; break;
				case 'K': $modifier = 30; break;
				case 'M': $modifier = 30; break;
				default: $modifier = 0;
			}
		}

		$roll = mt_rand(1,100) + $modifier;
		switch ($roll) {
			case ($roll <= 1):
				$roll2 = mt_rand(1, 100);
				switch ($roll2) {
					case ($roll2 <= 50):
						$result = genSpecType();
						break;
					case ($roll2 <= 78):
						$result = 'A';
						break;
					case ($roll2 <= 89):
						$result = 'B';
						break;
					case ($roll2 <= 92):
						$result = 'O';
						break;
					case ($roll2 <= 95):
						$roll3 = mt_rand(1,3);
						switch($roll3){
							case($roll3 <= 1):
								$result = 'L';
								break;
							case($roll3 <= 2):
								$result = 'T';
								break;
							default:
								$result = 'Y';
						}
						break;
					case ($roll2 <= 96):
						$result = 'W';
						break;						
					case ($roll2 <= 98):
						$roll3 = mt_rand(1,100);
						switch($roll3) {
							case($roll3 <= 1):
								if(mt_rand(1,2) == 1) {
									$result = 'AXP';
								} else {
									$result = 'SGR';
								}
								break;
							default:
								$result = 'PSR';
						}
						break;
					case ($roll2 <= 99):
						$result = 'X'; // Black Hole
						break;
					default:
						$result = 'Special';
						break;
				}
				break;
			case ($roll <= 6):
				$roll2 = mt_rand(1, 100);
				switch ($roll2) {
					case ($roll2 <= 80):
						$result = 'DA';
						break;
					case ($roll2 <= 94):
						$result = 'DB';
						break;
					case ($roll2 <= 97):
						$result = 'DC';
						break;
					case ($roll2 <= 98):
						$result = 'DQ';
						break;
					case ($roll2 <= 99):
						$result = 'DZ';
						break;
					case ($roll2 <= 100):
						$result = 'DO';
						break;
				}
				break;
			case ($roll <= 10):
				$result = 'F';
				break;
			case ($roll <= 18):
				$result = 'G';
				break;
			case ($roll <= 30):
				$result = 'K';
				break;
			default:
				$result = 'M';
				break;
		}
		return $result;
	}

	function genLumType($star){
		global $system;
		global $preceder;
		$spec = $star->spectralType;
		$result = '';
		$modifier;

		if($preceder) {
			switch ($preceder->luminosityType) {
				case '0': $modifier = 1; break;
				case 'Ia': $modifier = 2; break;
				case 'Ib': $modifier = 3; break;
				case 'II': $modifier = 5; break;
				case 'III': $modifier = 10; break;
				case 'IV': $modifier = 20; break;
				case 'V': $modifier = 30; break;
				case 'VI': $modifier = 90; break;
				default: $modifier = 0;
			}
		}

		if($spec == 'DA' || $spec == 'DB' || $spec == 'DO' || $spec == 'DQ' || $spec == 'DZ' || $spec == 'DC') {
			$result = 'VII';
		} else if ($spec == 'L' || $spec == 'T' || $spec == 'Y') {
			if(mt_rand(1,77) <= 70) {
				$result = 'V';
			} else {
				$result = 'IV';
			}
		} else {
			$roll = mt_rand(1,100) + $modifier;
			switch($roll) {
				case($roll <= 1):
					if($spec == 'K' || $spec == 'M') { // K and M hypergiants eliminated because their radii were way too huge
						$result = genLumType($star);
					} else {
						$result = '0';
					}
					break;
				case($roll <= 2):
					$result = 'Ia';
					break;
				case($roll <= 3):
					$result = 'Ib';
					break;
				case($roll <= 5):
					$result = 'II';
					break;
				case($roll <= 10):
					$result = 'III';
					break;
				case($roll <= 20):
					$result = 'IV';
					break;
				case($roll <= 90):
					$result = 'V';
					break;
				case($roll <= 97):
					$result = 'VI';
					break;
				default:
					$result = genLumType($star);
					break;			
			}
		}
		return $result;
	}

	function genSpecSubtype($star){
		$spec = $star->spectralType;
		$lum = $star->luminosityType;
		$result;
		if($spec == 'DA' || $spec == 'DB' || $spec == 'DO' || $spec == 'DQ' || $spec == 'DZ' || $spec == 'DC') {
			$result = mt_rand(1,99) / 10;
		} else if($spec == 'M'){ // Remove M class spectral subtypes that would result in radii that are too large
			switch($lum){
				case 'Ia':
					$result = mt_rand(0,2);
					break;
				case 'Ib':
					$result = mt_rand(0,4);
					break;
				case 'II':
					$result = mt_rand(0,6);
					break;
				case 'III':
					$result = mt_rand(0,8);
					break;
				default:
					$result = mt_rand(0,9);
			}
		} else {
			$result = mt_rand(0,9);
		}
		return $result;
	}

	function genTemp($star){
		$spec = $star->spectralType;
		$specSub = $star->spectralSubtype;
		$result;
		$roll = mt_rand(0,99);
		$rating = 0;

		if($spec == 'DA' || $spec == 'DB' || $spec == 'DO' || $spec == 'DQ' || $spec == 'DZ' || $spec == 'DC') {
			$result = 50400 / $specSub;
		} else {
			$rating = (1000 - ($specSub .= $roll)) / 1000;

			switch($spec) {
				case 'W':
					$result = $rating * 170000 + 30000;
					break;
				case 'O':
					$result = $rating * 30000 + 30000;
					break;
				case 'B':
					$result = $rating * 20000 + 10000;
					break;
				case 'A':
					$result = $rating * 2500 + 7500;
					break;
				case 'F':
					$result = $rating * 1500 + 6000;
					break;
				case 'G':
					$result = $rating * 1000 + 5000;
					break;
				case 'K':
					$result = $rating * 1500 + 3500;
					break;
				case 'M':
					$result = $rating * 1500 + 2000;
					break;
				case 'L':
					$result = $rating * 700 + 1300;
					break;
				case 'T':
					$result = $rating * 600 + 700;
					break;
				case 'Y':
					$result = $rating * 100 + 500;
					break;
			}
		}
		$tempFactor = $result / 5778;
		return $result;
	}



	function genRad($star){
		$spec = $star->spectralType;
		$lum = $star->luminosityType;
//		$temp = $star->temperature;
//		$mass = $star->mass;

		global $radiusTable;

		if($spec == 'L') {
			$index = 56;
		} else if($spec == 'T') {
			$index = 57;
		} else if($spec == 'Y') {
			$index = 58;
		} else if($spec == 'DA' || $spec == 'DB' || $spec == 'DO' || $spec == 'DQ' || $spec == 'DZ' || $spec == 'DC') {
			$index = 59;
		} else {
			switch($spec){
				case 'O': $specIndex = 0; break;
				case 'B': $specIndex = 1; break;
				case 'A': $specIndex = 2; break;
				case 'F': $specIndex = 3; break;
				case 'G': $specIndex = 4; break;
				case 'K': $specIndex = 5; break;
				case 'M': $specIndex = 6; break;
			}
			switch($lum){
				case '0': $lumIndex = 0; break;
				case 'Ia': $lumIndex = 1; break;
				case 'Ib': $lumIndex = 2; break;
				case 'II': $lumIndex = 3; break;
				case 'III': $lumIndex = 4; break;
				case 'IV': $lumIndex = 5; break;
				case 'V': $lumIndex = 6; break;
				case 'VI': $lumIndex = 7; break;
			}
			$index = $specIndex * 8 + $lumIndex;
		}
		$baseR = $radiusTable[$index][round($subSpec)];

		$result = ($baseR * 0.75) + ($baseR * 0.5 * (mt_rand(0, 1000) / 1000));

//		$result = sqrt($lum / (4 * pi() * (5.6704 * pow(10, -8)) * pow($temp, 4)) );
/*		
		if($spec == 'DA' || $spec == 'DB' || $spec == 'DO' || $spec == 'DQ' || $spec == 'DZ' || $spec == 'DC') {
			$result = 0.01 * pow(1/$mass, 1/3);
		} else if($spec == 'Neutron Star') {
			$result = (14 * pow($mass / 1.4, -1/3)) / 695500;
		}else {
			$result = pow((5778/$temp), 2) * pow($lum, 1/2);
		}
*/
		return $result;

	}

	function genLum($star){
		$rad = $star->radius;
		$temp = $star->temperature;
		$result = pow($rad, 2) * pow($temp / 5778, 4);
		return $result;
	}


	function genMass($star){
		$spec = $star->spectralType;
		$specSub = $star->spectralSubtype;
		$lumType = $star->luminosityType;

		global $massTable;

		if($spec == 'L') {
			$index = 56;
		} else if($spec == 'T') {
			$index = 57;
		} else if($spec == 'Y') {
			$index = 58;
		} else if($lumType == 'VII') {
			$index = 59;
		} else {
			switch($spec){
				case 'O': $specIndex = 0; break;
				case 'B': $specIndex = 1; break;
				case 'A': $specIndex = 2; break;
				case 'F': $specIndex = 3; break;
				case 'G': $specIndex = 4; break;
				case 'K': $specIndex = 5; break;
				case 'M': $specIndex = 6; break;
			}
			switch($lumType){
				case '0': $lumIndex = 0; break;
				case 'Ia': $lumIndex = 1; break;
				case 'Ib': $lumIndex = 2; break;
				case 'II': $lumIndex = 3; break;
				case 'III': $lumIndex = 4; break;
				case 'IV': $lumIndex = 5; break;
				case 'V': $lumIndex = 6; break;
				case 'VI': $lumIndex = 7; break;
			}
			$index = $specIndex * 8 + $lumIndex;
		}
		$specSub = round($specSub);
		if($specSub > 9) $specSub = 9;
		$baseM = $massTable[$index][$specSub];
		$result = ($baseM * 0.75) + ($baseM * 0.5 * (mt_rand(0, 1000) / 1000));			

		return $result;
	}


	function genHZ($lum) {
		$result = array( round( 0.7 * sqrt($lum), 4), round( 3 * sqrt($lum), 4) );
		return $result;
	}

	function genHasPrimeJovian(){
		global $system;
		$result;
		$primary = $system->stars[0];
		$roll = mt_rand(1,100);

		if(
			$primary->spectralType == 'O' ||
			$primary->spectralType == 'B' ||
			$primary->luminosityType == '0' ||
			$primary->luminosityType == 'Ia' ||
			$primary->luminosityType == 'Ib' ||
			$primary->luminosityType == 'II' ||
			$primary->luminosityType == 'III'
			) {
			switch($roll){
				case ($roll <= 90): $result = false; break;
				default: $result = true;
			}
		} else if (
			$primary->spectralType == 'A' ||
			$primary->spectralType == 'F' ||
			$primary->spectralType == 'G' ||
			$primary->spectralType == 'K' ||
			$primary->luminosityType == 'IV' ||
			$primary->luminosityType == 'V'
			) {
			switch($roll){
				case ($roll <= 80): $result = false; break;
				default: $result = true;
			}
		} else {
			switch($roll){
				case ($roll <= 70): $result = false; break;
				default: $result = true;
			}
		}
		return $result;
	}

	function genPrimeJovian(){
		global $primary;
		$primeJovian = new PLANET();

		$modifier = 0;
		if(
			$primary->spectralType == 'O' ||
			$primary->spectralType == 'B' ||
			$primary->luminosityType == '0' ||
			$primary->luminosityType == 'Ia' ||
			$primary->luminosityType == 'Ib' ||
			$primary->luminosityType == 'II' ||
			$primary->luminosityType == 'III'
		) { $modifier = 15; }

		$roll = mt_rand(1, 100) + $modifier;
		switch($roll){
			case ($roll <= 10): $orbit = 'epistellar'; break;
			case ($roll <= 25): $orbit = 'inner'; break;
			case ($roll <= 90): $orbit = 'middle'; break;
			default: $orbit = 'outer'; break;
		}
		switch($orbit){
			case 'epistellar':
				$roll = mt_rand(1,100);
				switch($roll){
					case($roll <= 10): $orbitRadius = 0.02; break;
					case($roll <= 30): $orbitRadius = 0.04; break;
					case($roll <= 50): $orbitRadius = 0.07; break;
					case($roll <= 70): $orbitRadius = 0.1; break;
					case($roll <= 90): $orbitRadius = 0.15; break;
					default: $orbitRadius = 0.2;
				}
				break;
			case 'inner':
				$roll = mt_rand(1,100);
				switch($roll){
					case($roll <= 10): $orbitRadius = 0.2; break;
					case($roll <= 20): $orbitRadius = 0.4; break;
					case($roll <= 30): $orbitRadius = 0.6; break;
					case($roll <= 40): $orbitRadius = 0.8; break;
					case($roll <= 50): $orbitRadius = 1; break;
					case($roll <= 60): $orbitRadius = 1.2; break;
					case($roll <= 70): $orbitRadius = 1.4; break;
					case($roll <= 80): $orbitRadius = 1.6; break;
					case($roll <= 90): $orbitRadius = 1.8; break;
					default: $orbitRadius = 2;
				}
				break;
			case 'middle':
				$roll = mt_rand(1,100);
				switch($roll){
					case($roll <= 7): $orbitRadius = 2; break;
					case($roll <= 15): $orbitRadius = 2.5; break;
					case($roll <= 23): $orbitRadius = 3; break;
					case($roll <= 31): $orbitRadius = 3.5; break;
					case($roll <= 38): $orbitRadius = 4; break;
					case($roll <= 46): $orbitRadius = 4.5; break;
					case($roll <= 54): $orbitRadius = 5; break;
					case($roll <= 62): $orbitRadius = 5.5; break;
					case($roll <= 69): $orbitRadius = 6; break;
					case($roll <= 77): $orbitRadius = 6.5; break;
					case($roll <= 85): $orbitRadius = 7; break;
					case($roll <= 93): $orbitRadius = 7.5; break;
					default: $orbitRadius = 8;
				}
				break;
			default:
				$roll = mt_rand(1,100);
				switch($roll){
					case($roll <= 7): $orbitRadius = 8; break;
					case($roll <= 15): $orbitRadius = 9; break;
					case($roll <= 23): $orbitRadius = 10; break;
					case($roll <= 31): $orbitRadius = 11; break;
					case($roll <= 38): $orbitRadius = 12; break;
					case($roll <= 46): $orbitRadius = 13; break;
					case($roll <= 54): $orbitRadius = 14; break;
					case($roll <= 62): $orbitRadius = 15; break;
					case($roll <= 69): $orbitRadius = 16; break;
					case($roll <= 77): $orbitRadius = 17; break;
					case($roll <= 85): $orbitRadius = 18; break;
					case($roll <= 93): $orbitRadius = 19; break;
					default: $orbitRadius = 20;
				}
				break;
			$orbitRadius = $orbitRadius * $primary->mass;
		}

		$primeJovian->orbitRadius = $orbitRadius;

		return $primeJovian;
	}

	function genNumPlanets(){
		global $system;
		$result;
		$modifier = 0;
		$primary = $system->stars[0];
		$hasPrime = $system->hasPrimeJovian;

		if($primary->luminosityType == '0') $modifier -= 50;
		if($primary->luminosityType == 'Ia') $modifier -= 50;
		if($primary->luminosityType == 'Ib') $modifier -= 50;
		if($primary->luminosityType == 'II') $modifier -= 25;
		if($primary->luminosityType == 'III') $modifier -= 10;
		if($primary->luminosityType == 'IV') $modifier -= 5;
		if($primary->spectralType == 'O') $modifier -= 25;
		if($primary->spectralType == 'B') $modifier -= 15;
		if($primary->spectralType == 'A') $modifier -= 5;
		if(count($system->stars) == 2) $modifier -= 25;
		if(count($system->stars) == 3) $modifier -= 50;
		if(count($system->stars) == 4) $modifier -= 75;
		if( $hasPrime ){ $modifier -= 6; } else { $modifier += 15; }

		$roll = mt_rand(1,100) + $modifier;

		switch($roll) {
			case ($roll <= 25): $result = mt_rand(1,5); break;
			case ($roll <= 50): $result = mt_rand(1,8); break;
			case ($roll <= 69): $result = mt_rand(1,10); break;
			case ($roll <= 72): $result = mt_rand(1,10) + 2; break;
			case ($roll <= 74): $result = mt_rand(1,10) + 5; break;
			case ($roll <= 75): $result = mt_rand(1,10) + 8; break;
			default: $result = 0;
		}

		if(count($system->stars) >= 5) $result = 0;

		if($hasPrime) $result = $result;

		return $result;

	}

	function genColor($temp){
		// Color algorithm from http://www.tannerhelland.com/4435/convert-temperature-rgb-algorithm-code/

		$result = array();

		if($temp < 1000) $temp = 1000;
		if($temp > 40000) $temp = 40000;

		$temp = $temp / 100;

		// Red
		if($temp <= 66){
			$red = 255;
		} else {
			$red = $temp - 60;
			$red = 329.698727446 * pow($red, -0.1332047592);
			if($red < 0) $red = 0;
			if($red > 255) $red = 255;
		}

		// Green
		if($temp <= 66) {
			$green = $temp;
			$green = 99.4708025861 * log($green) - 161.1195681661;
			if($green < 0) $green = 0;
			if($green > 255) $green = 255;
		} else {
			$green = $temp - 60;
			$green = 288.1221695283 * pow($green, -0.0755148492);
			if($green < 0) $green = 0;
			if($green > 255) $green = 255;
		}

		// Blue
		if($temp >= 66) {
			$blue = 255;
		} else if ($temp <= 19) {
			$blue = 0;
		} else {
			$blue = $temp - 10;
			$blue = 138.5177312231 * log($blue) - 305.0447927307;
			if($blue < 0) $blue = 0;
			if($blue > 255) $blue = 255;
		}

		$result = array($red, $green, $blue);

		return $result;
	}

/*
	function genPlanets(){
		global $system;

		$planetNum = genNumPlanets();

		// Generate Prime Jovian
		$system->hasPrimeJovian = genHasPrimeJovian();
		if($system->hasPrimeJovian) array_push($system->planets, genPrimeJovian() );
	}
*/
	header('Content-Type: application/json');
	echo json_encode($data);

?>