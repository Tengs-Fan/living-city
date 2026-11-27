// Name tables. The census draws from these; nobody in the city is written by hand.

export const FIRST_M = [
  'Jason', 'Marcus', 'Luis', 'Andre', 'Daniel', 'Victor', 'Omar', 'Felix', 'Hugo', 'Ivan',
  'Tomas', 'Ray', 'Elias', 'Caleb', 'Darius', 'Mateo', 'Jonah', 'Nico', 'Rafael', 'Samuel',
  'Theo', 'Wade', 'Xavier', 'Yusuf', 'Zane', 'Arturo', 'Ben', 'Carl', 'Dmitri', 'Emil',
  'Frank', 'Gabriel', 'Hector', 'Isaac', 'Joel', 'Kenji', 'Leon', 'Malik', 'Nathan', 'Oscar',
  'Pablo', 'Quentin', 'Roman', 'Sergio', 'Tariq', 'Uri', 'Vince', 'Walter', 'Anton', 'Bruno',
  'Cyrus', 'Desmond', 'Eddie', 'Gus', 'Hank', 'Jamal', 'Kofi', 'Lars', 'Miguel', 'Noel',
  'Otis', 'Pavel', 'Reggie', 'Silas', 'Terrence', 'Amir', 'Curtis', 'Dante', 'Earl', 'Julio',
  'Kwame', 'Lionel', 'Moses', 'Ned', 'Paolo', 'Ravi', 'Stefan', 'Tobias', 'Vikram', 'Wes',
];

export const FIRST_F = [
  'Maria', 'Elena', 'Grace', 'Nadia', 'Rosa', 'Tessa', 'Alma', 'Bianca', 'Carmen', 'Delia',
  'Esther', 'Faye', 'Gloria', 'Hana', 'Ines', 'Joan', 'Kira', 'Lena', 'Mona', 'Nora',
  'Olive', 'Paula', 'Renee', 'Sofia', 'Thea', 'Uma', 'Vera', 'Wanda', 'Yara', 'Zoe',
  'Adele', 'Beth', 'Celia', 'Dora', 'Edith', 'Flora', 'Gemma', 'Helen', 'Irene', 'Jada',
  'Keisha', 'Lucia', 'Mei', 'Nina', 'Odette', 'Priya', 'Ruth', 'Selma', 'Tanya', 'Ursula',
  'Violet', 'Willa', 'Amara', 'Bea', 'Coral', 'Dinah', 'Elsa', 'Farah', 'Gwen', 'Hattie',
  'Imani', 'June', 'Katya', 'Leila', 'Marta', 'Noor', 'Opal', 'Pearl', 'Rita', 'Simone',
  'Talia', 'Valeria', 'Winnie', 'Ximena', 'Yvonne', 'Agnes', 'Camila', 'Dalia', 'Ebony', 'Lourdes',
];

export const LAST = [
  'Okafor', 'Reyes', 'Lindqvist', 'Marsh', 'Delgado', 'Brandt', 'Achebe', 'Castillo', 'Dunmore', 'Eze',
  'Farrow', 'Gallo', 'Haddad', 'Ibarra', 'Jansen', 'Kowalski', 'Lachance', 'Moreno', 'Nakamura', 'Oyelaran',
  'Petrov', 'Quintero', 'Rossi', 'Santos', 'Tanaka', 'Usman', 'Vasquez', 'Whitlock', 'Yilmaz', 'Zamora',
  'Abbott', 'Baptiste', 'Calloway', 'Draper', 'Espinoza', 'Fontaine', 'Greer', 'Holloway', 'Iyer', 'Juarez',
  'Kessler', 'Lombardi', 'Mbeki', 'Novak', 'Ortega', 'Pruitt', 'Quigley', 'Rahman', 'Sokolov', 'Thibault',
  'Underhill', 'Varga', 'Wexler', 'Yoon', 'Zielinski', 'Adeyemi', 'Barros', 'Chen', 'Dimitrov', 'Ellery',
  'Fitzroy', 'Guerrero', 'Hoang', 'Imhoff', 'Jefferies', 'Kaur', 'Lovell', 'Mwangi', 'Nunez', 'Osei',
  'Pacheco', 'Rinaldi', 'Suarez', 'Trask', 'Ueda', 'Vance', 'Winslow', 'Yates', 'Aguilar', 'Bowers',
  'Cardenas', 'Dossou', 'Enright', 'Fofana', 'Gaines', 'Hartley', 'Ishikawa', 'Jimenez', 'Kovac', 'Laurent',
  'Mendez', 'Ndiaye', 'Olsen', 'Pereira', 'Romero', 'Stavros', 'Tran', 'Vidal', 'Waller', 'Zubiri',
  'Ashworth', 'Bellamy', 'Corrigan', 'Dalca', 'Emmerich', 'Figueroa', 'Grady', 'Hussain', 'Ivanov', 'Kader',
  'Lozano', 'Maddox', 'Nwosu', 'Pike', 'Rourke', 'Salazar', 'Toledo', 'Vogel', 'Ward', 'Xu',
];

export const STREETS = [
  'Alder', 'Birch', 'Cedar', 'Dalton', 'Elm', 'Fenwick', 'Garnet', 'Hollis', 'Iris', 'Juniper',
  'Kestrel', 'Laurel', 'Mercer', 'Nolan', 'Orchard', 'Pryor', 'Quince', 'Rowan', 'Sable', 'Tamar',
  'Union', 'Vale', 'Wren', 'Yarrow', 'Zenith', 'Ashby', 'Bram', 'Corliss', 'Devon', 'Ember',
  'Finch', 'Gable', 'Harrow', 'Ives', 'Jasper', 'Kimball', 'Lark', 'Minter', 'Noble', 'Osprey',
  'Pine', 'Quarry', 'Reed', 'Spruce', 'Thorn', 'Upton', 'Vine', 'Willow',
];

export function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
}
